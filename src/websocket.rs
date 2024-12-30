use futures::stream::SplitSink;
use futures::SinkExt;
use futures::StreamExt;
use redis::AsyncCommands;
use redis::RedisResult;
use std::fmt;
use std::fmt::{Display, Error};
use std::sync::Arc;
use tokio::select;
use tokio::task::JoinHandle;
use warp::filters::ws::Message;

use futures::stream::SplitStream;
use redis::Client;
use serde::{Deserialize, Serialize};
use serde_tuple::{Deserialize_tuple, Serialize_tuple};
use tokio::sync::Mutex;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tracing::{debug, error, info, warn};
use uuid::Uuid;
use warp::filters::ws::WebSocket;

use crate::channel::{ChannelControl, ChannelMessage};

/// reply data structures
#[derive(Clone, Debug, Serialize_tuple)]
pub struct ReplyMessage {
    pub join_ref: Option<String>, // null when it's heartbeat
    pub event_ref: String,
    pub topic: String, // `channel`
    pub event: String,
    pub payload: ReplyPayload,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReplyPayload {
    pub status: String,
    // 两种情况
    pub response: Response,
    // pub response: serde_json::Value,
}

/// 从 websocket 反序列化的
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Response {
    #[serde(rename = "join")]
    Join {},

    #[serde(rename = "heartbeat")]
    Heartbeat {},

    #[serde(rename = "datetime")]
    Datetime { datetime: String, counter: u32 },

    #[serde(rename = "message")]
    Message { message: String },

    #[serde(rename = "null")]
    Empty {},
}

/// 从 Redis 反序列化的, 之后转发到 websocket
/// 序列化的时候需要和 Response 保持一致
/// 会增加一个 type 字段，分别是 null, join, Heartbeat, datetime, message
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ResponseFromRedis {
    #[serde(rename = "null")]
    Empty {},

    #[serde(rename = "join")]
    Join {},

    #[serde(rename = "heartbeat")]
    Heartbeat {},

    #[serde(rename = "datetime")]
    Datetime { datetime: String, counter: u32 },

    #[serde(rename = "message")]
    Message { message: String },
}

impl Into<Response> for ResponseFromRedis {
    fn into(self) -> Response {
        match self {
            ResponseFromRedis::Empty {} => Response::Empty {},
            ResponseFromRedis::Join {} => Response::Join {},
            ResponseFromRedis::Heartbeat {} => Response::Heartbeat {},
            ResponseFromRedis::Datetime { datetime, counter } => {
                Response::Datetime { datetime, counter }
            }
            ResponseFromRedis::Message { message } => Response::Message { message },
        }
    }
}

impl fmt::Display for ReplyMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Format the response based on its variant
        // let response_str = match &self.payload.response {
        //     Response::Empty {} => "Empty".to_string(),
        //     Response::Join {} => "Join".to_string(),
        //     Response::Heartbeat {} => "Heartbeat".to_string(),
        //     Response::Datetime { datetime, counter } => {
        //         format!("<Datetime '{}' {}>", datetime, counter)
        //     }
        //     Response::Message { message } => format!("{{message: {}}}", message),
        // };
        let response_str = "...";

        write!(
            f,
            "Message join_ref={}, ref={}, topic={}, event={}, <Payload status={}, response={}>",
            self.join_ref.clone().unwrap_or("None".to_string()),
            self.event_ref,
            self.topic,
            self.event,
            self.payload.status,
            response_str
        )
    }
}

// request data structures
// RequestMessage is a message from client through websocket
// it's deserialized from a JSON array
#[derive(Debug, Deserialize_tuple)]
struct RequestMessage {
    join_ref: Option<String>, // null when it's heartbeat
    event_ref: String,
    topic: String, // `channel`
    event: String,
    payload: RequestPayload,
}

impl Display for RequestMessage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> Result<(), Error> {
        write!(
            formatter,
            "<RequestMessage: join_ref={:?}, ref={}, topic={}, event={}, payload=...>",
            self.join_ref, self.event_ref, self.topic, self.event
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
enum RequestPayload {
    Join { token: String },
    Message { message: String },
    // Empty {}, // for both leave & heartbeat, the last
    JsonValue(serde_json::Value),
}

pub struct State {
    pub ctl: Mutex<ChannelControl>,
    pub redis_url: String,
    pub redis_client: redis::Client,
    pub jwt_secret: String,
}

/// handle websocket connection
pub async fn on_connected(ws: WebSocket, state: Arc<State>) {
    let conn_id = Uuid::new_v4().to_string(); // 服务端生成的，内部使用
    info!("on_connected, new client: {}", conn_id);

    state.ctl.lock().await.conn_add_tx(conn_id.clone()).await;

    let (ws_tx, ws_rx) = ws.split();

    let mut ws_tx_task = tokio::spawn(websocket_tx(conn_id.clone(), state.clone(), ws_tx));
    let mut ws_rx_task = tokio::spawn(websocket_rx(ws_rx, state.clone(), conn_id.clone()));
    tokio::select! {
        _ = (&mut ws_tx_task) => ws_rx_task.abort(),
        _ = (&mut ws_rx_task) => ws_tx_task.abort(),
    }

    state.ctl.lock().await.agent_rm(conn_id.to_string()).await;
    info!("client connection closed");
}

/// 把消息经由 websocket 发送到客户端: conn rx => ws tx
async fn websocket_tx(cid: String, state: Arc<State>, mut ws_tx: SplitSink<WebSocket, Message>) {
    debug!("launch websocket sender ...");

    let mut conn_rx = state.ctl.lock().await.conn_rx(cid.clone()).await.unwrap();
    while let Ok(channel_message) = conn_rx.recv().await {
        let ChannelMessage::Reply(reply_message) = channel_message;
        let text = serde_json::to_string(&reply_message).unwrap();
        let result = ws_tx.send(warp::ws::Message::text(text)).await;
        if result.is_err() {
            error!("websocket tx sending failed: {}", result.err().unwrap());
            continue; // what happend? exit if the connection is lost
        }
    }
}

/// default event handler
async fn websocket_rx(
    mut ws_rx: SplitStream<WebSocket>,
    state: Arc<State>,
    cid: String,
) -> RedisResult<()> {
    info!("handle events ...");

    let redis_client = Client::open(state.redis_url.clone())?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;

    while let Some(Ok(m)) = ws_rx.next().await {
        if !m.is_text() {
            // 也可能是 binary 的，暂时不处理
            continue;
        }
        info!("read from websocket: `{}`", m.to_str().unwrap());
        let rm_result = serde_json::from_str::<RequestMessage>(m.to_str().unwrap());
        if rm_result.is_err() {
            error!("error: {}", rm_result.err().unwrap());
            continue;
        }
        let rm: RequestMessage = rm_result.unwrap();
        let channel_name = &rm.topic;
        let join_ref = &rm.join_ref;
        let event_ref = &rm.event_ref;
        let event = &rm.event;
        let payload = &rm.payload;

        if channel_name == "phoenix" && event == "heartbeat" {
            send_ok_empty(&cid.clone(), None, event_ref, "phoenix", state.clone()).await;
            debug!("heartbeat processed");
            // continue;
        }

        if event == "phx_join" {
            handle_join(&rm, state.clone(), &cid).await;
            debug!("join processed");
            // continue;
        }

        if event == "phx_leave" {
            handle_leaving(
                state.clone(),
                &cid.clone(),
                join_ref.clone(),
                event_ref,
                channel_name.clone(),
            )
            .await;
            debug!("leave processed");
            // continue;
        }

        // all events are dispatched to reids
        dispatch_by_redis(
            &mut redis_conn,
            channel_name.clone(),
            event.clone(),
            payload,
        )
        .await?;
    }
    Ok(())
}

/// events from client are published over redis
/// iredis --url redis://localhost:6379 psubscribe 'from*'
async fn dispatch_by_redis(
    redis_conn: &mut redis::aio::MultiplexedConnection,
    channel_name: String,
    event_name: String,
    payload: &RequestPayload,
) -> RedisResult<()> {
    let redis_topic = format!("from:{}:{}", channel_name, event_name);
    let message = serde_json::to_string(&payload).unwrap();
    let result: RedisResult<String> = redis_conn.publish(redis_topic, message.clone()).await;
    if result.is_err() {
        error!("fail to publish to redis: {}", result.err().unwrap());
    } else {
        debug!("publish over redis: {}", message.clone());
    }
    Ok(())
}

// 添加 agent tx, join channel, spawn agent/conn relay task, ack joining
// NOTE: relay task 在连接断开的时候会发生什么?
async fn handle_join(
    rm: &RequestMessage,
    state: Arc<State>,
    conn_id: &str,
) -> JoinHandle<RedisResult<()>> {
    let channel_name = &rm.topic; // ?
    let agent_id = format!("{}:{}", conn_id, rm.join_ref.clone().unwrap());
    let join_ref = &rm.join_ref;
    let event_ref = &rm.event_ref;

    info!("{} joining {} ...", agent_id, channel_name.clone(),);
    state
        .ctl
        .lock()
        .await
        .agent_add(agent_id.to_string(), None)
        .await;
    state
        .ctl
        .lock()
        .await
        .channel_join(&channel_name.clone(), agent_id.to_string())
        .await
        .unwrap();

    // agent rx 到 conn tx 转发消息
    // 这个需要在 join 完整之前准备好，才不会丢失消息
    let relay_task = tokio::spawn(agent_to_conn(
        state.clone(),
        channel_name.clone(),
        join_ref.clone().unwrap(),
        agent_id.clone(),
        conn_id.to_string(),
    ));

    // phx_reply, 确认 join 事件
    send_ok_empty(
        conn_id,
        join_ref.clone(),
        event_ref,
        channel_name,
        state.clone(),
    )
    .await;
    relay_task
}

async fn get_redis_pubsub_stream(
    redis_topic: String,
    redis_url: String,
) -> RedisResult<redis::aio::PubSub> {
    let redis_client = Client::open(redis_url)?;
    let mut redis_pubsub = redis_client.get_async_pubsub().await?;
    redis_pubsub.psubscribe(redis_topic.clone()).await?;
    Ok(redis_pubsub)
}

#[derive(Debug)]
struct ChannelEventFromRedis {
    channel: String,
    event: String,
}

impl ChannelEventFromRedis {
    /// parse the format to:channel_name:event_name
    fn parse(redis_channel: &str) -> Result<Self, &'static str> {
        let components: Vec<&str> = redis_channel.split(':').collect();
        match components.as_slice() {
            [_, channel, event] => Ok(Self {
                channel: channel.to_string(),
                event: event.to_string(),
            }),
            _ => Err("invalid channel format"),
        }
    }
}

async fn agent_to_conn(
    state: Arc<State>,
    channel_name: String,
    join_ref: String,
    agent_id: String,
    conn_id: String,
) -> RedisResult<()> {
    let mut agent_rx = state
        .ctl
        .lock()
        .await
        .agent_subscriber(agent_id.clone())
        .await
        .unwrap();
    let conn_tx = state
        .ctl
        .lock()
        .await
        .conn_tx(conn_id.clone())
        .await
        .unwrap();

    let redis_url = state.redis_url.clone();
    let redis_topic = format!("to:{}:*", channel_name);
    let mut redis_pubsub = get_redis_pubsub_stream(redis_topic, redis_url.clone())
        .await
        .unwrap();
    let mut redis_pubsub_stream = redis_pubsub.on_message();

    debug!("agent {} => conn {}", agent_id.clone(), conn_id.clone());
    let mut counter = 0;
    loop {
        select! {
            channel_message_opt = agent_rx.recv() =>  {
                if let Ok(mut channel_message) = channel_message_opt {
                    let ChannelMessage::Reply(ref mut reply) = channel_message;
                    reply.join_ref = Some(join_ref.clone());
                    let result = conn_tx.send(channel_message.clone());
                    if result.is_err() {
                        error!("agent {}, conn: {}, sending failure: {:?}", agent_id, conn_id, result.err().unwrap());
                        break; // fails when there's no reciever, stop forwarding
                    }
                    // debug!("F {}", channel_message);
                }
            },
            optional_message = redis_pubsub_stream.next() => {
                if optional_message.is_none() {
                    error!("agent_to_conn / from redis: none");
                    continue;
                }

                let stream_message = optional_message.unwrap();
                let payload: String = stream_message.get_payload()?;
                debug!("agent_to_conn / from redis, {}, payload: `{}`", stream_message.get_channel_name(), payload.clone());

                let response_from_redis_result = serde_json::from_str::<ResponseFromRedis>(&payload);
                if response_from_redis_result.is_err() {
                    warn!("fail to deserialize from Redis, {}, payload: `{}`", response_from_redis_result.err().unwrap(), payload);
                    continue;
                }
                let response: Response = response_from_redis_result.unwrap().into();
                debug!("parsed from redis, response: {:?}", &response);

                // the format is to:channel_name:event_name, split it by `:`
                match ChannelEventFromRedis::parse(stream_message.get_channel_name()) {
                    Ok(msg) => _channel_publish(counter, response, state.clone(), &msg.channel, &msg.event).await,
                    Err(e) => {
                        warn!("Invalid redis channel format: {}", e);
                        continue;
                    }
                }
                counter += 1;
                debug!("publish message from redis, counter: {}", counter);
            }
        }
    }
    Ok(())
}

async fn handle_leaving(
    state: Arc<State>,
    cid: &str,
    join_ref: Option<String>,
    event_ref: &str,
    channel_name: String,
) {
    state
        .ctl
        .lock()
        .await
        .channel_leave(channel_name.clone(), cid.to_string())
        .await
        .unwrap();
    send_ok_empty(cid, join_ref, event_ref, &channel_name, state.clone()).await;
}

async fn send_ok_empty(
    conn_id: &str,
    join_ref: Option<String>,
    event_ref: &str,
    channel_name: &str,
    state: Arc<State>,
) {
    let join_reply_message = ReplyMessage {
        join_ref: join_ref.clone(),
        event_ref: event_ref.to_string(),
        topic: channel_name.to_string(),
        event: "phx_reply".to_string(),
        payload: ReplyPayload {
            status: "ok".to_string(),
            // response: serde_json::json!({}),
            response: Response::Empty {},
        },
    };
    let text = serde_json::to_string(&join_reply_message).unwrap();
    debug!(
        "sending empty response, channel: {}, join_ref: {:?}, ref: {}, {}",
        channel_name, join_ref, event_ref, text
    );
    state
        .ctl
        .lock()
        .await
        .conn_send(
            conn_id.to_string(),
            ChannelMessage::Reply(join_reply_message),
        )
        .await
        .unwrap();
    debug!("sent to connection {}: {}", &conn_id, text);
}

async fn _channel_publish(
    counter: i32,
    response: Response,
    state: Arc<State>,
    channel_name: &str,
    event_name: &str,
) {
    let reply_message = ReplyMessage {
        join_ref: None,
        event_ref: counter.to_string(),
        topic: channel_name.to_string(),
        event: event_name.to_string(),
        payload: ReplyPayload {
            status: "ok".to_string(),
            response,
        },
    };

    // unexpected error: Error("can only flatten structs and maps (got a integer)", line: 0, column: 0)
    // let serialized_result = serde_json::to_string(&reply_message);
    // if serialized_result.is_err() {
    //     error!("error: {}", serialized_result.err().unwrap());
    //     return;
    // }
    // let text = serialized_result.unwrap();

    match state
        .ctl
        .lock()
        .await
        .channel_broadcast(
            channel_name.to_string(),
            ChannelMessage::Reply(reply_message.clone()),
        )
        .await
    {
        Ok(_) => {
            debug!("published, {} > {}", event_name, reply_message);
        }
        Err(_e) => {
            // it throws error if there's no client
            // error!(
            //     "fail to send, channel: {}, event: {}, err: {}",
            //     channel_name, event_name, e
            // );
        }
    }
}

pub async fn streaming_default_tx_handler(
    state: Arc<State>,
    mut rx: UnboundedReceiverStream<String>,
    channel_name: &str,
    event_name: &str,
) -> redis::RedisResult<()> {
    info!("launch data task ...");
    let mut counter = 0;

    let redis_topic = format!("{}:{}", channel_name, event_name);
    let redis_client = Client::open(state.redis_url.clone())?;
    let mut redis_pubsub = redis_client.get_async_pubsub().await?;
    redis_pubsub.subscribe(redis_topic.clone()).await?;
    let mut redis_pubsub_stream = redis_pubsub.on_message();
    info!("subscribe to {} {} ...", state.redis_url, redis_topic);

    loop {
        select! {
            Some(message) = rx.next() => {
                match serde_json::from_str::<Response>(&message) {
                    Err(_e) => continue,
                    Ok(response) => {
                        _channel_publish(counter, response, state.clone(), channel_name, event_name).await;
                        counter += 1;
                        debug!("publish message from memory, counter: {}", counter);
                    }
                }
            },
            optional_message = redis_pubsub_stream.next() => {
                match optional_message {
                    Some(stream_message) => {
                        let payload: String = stream_message.get_payload()?;
                        debug!("got from redis: {}", payload.clone());

                        match serde_json::from_str::<ResponseFromRedis>(&payload) {
                            Err(e) => {
                                warn!("fail to deserialize from Redis, {}, payload: {}", e, payload);
                                continue;
                            },
                            Ok(response_from_redis) => {
                                let response = response_from_redis.into();
                                debug!("parsed from redis, response: {:?}", &response);
                                _channel_publish(counter, response, state.clone(), channel_name, event_name).await;

                                counter += 1;
                                debug!("publish message from redis, counter: {}", counter);
                            }
                        }
                    },
                    None => {
                        error!("publish message from redis, connection lost");
                        // TODO: exit and run this again?
                    }
                }
            }
        }
    }
}

// 每秒发送一个时间戳
pub async fn system_default_tx_handler(state: Arc<State>, channel_name: &str) {
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

    info!("launch system/datetime task...");
    let mut counter = 0;
    let event = "datetime";
    loop {
        let now = chrono::Local::now();
        let message = ReplyMessage {
            join_ref: None,
            event_ref: counter.to_string(),
            topic: channel_name.to_string(),
            event: event.to_string(),
            payload: ReplyPayload {
                status: "ok".to_string(),
                // response: serde_json::json!({
                //     "datetime": now.to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
                //     "counter": counter,
                // }),
                response: Response::Datetime {
                    datetime: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
                    counter,
                },
            },
        };
        // let text = serde_json::to_string(&message).unwrap();
        match state
            .ctl
            .lock()
            .await
            .channel_broadcast(channel_name.to_string(), ChannelMessage::Reply(message))
            .await
        {
            Ok(0) => {} // no client
            Ok(_) => {} // debug!("datetime > {}", text),
            Err(_e) => {
                // FIXME: when thers's no client, it's an error
                // error!("`{}` `{}`, {}, {}", channel_name, event, e, text)
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        counter += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::{SinkExt, StreamExt};
    use serde_json::json;
    use std::collections::HashSet;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;
    use warp::Filter;

    async fn setup_test_server() -> (String, Arc<State>) {
        let redis_url = "redis://192.168.11.37:6379".to_string(); // FIXME
        let redis_client = redis::Client::open(redis_url.clone()).unwrap();
        let state = Arc::new(State {
            ctl: Mutex::new(ChannelControl::new()),
            redis_url,
            redis_client,
        });

        // Setup channels
        state
            .ctl
            .lock()
            .await
            .channel_add("phoenix".into(), None)
            .await;
        state
            .ctl
            .lock()
            .await
            .channel_add("system".into(), None)
            .await;
        state
            .ctl
            .lock()
            .await
            .channel_add("streaming".into(), None)
            .await;

        // Spawn system task
        tokio::spawn(system_default_tx_handler(state.clone(), "system"));

        let websocket_shared_state = state.clone();
        let websocket_shared_state = warp::any().map(move || websocket_shared_state.clone());
        let ws = warp::path("websocket")
            .and(warp::ws())
            .and(websocket_shared_state)
            .map(|ws: warp::ws::Ws, state| {
                ws.on_upgrade(move |socket| on_connected(socket, state))
            });

        let (addr, server) = warp::serve(ws).bind_ephemeral(([127, 0, 0, 1], 0));
        let addr = format!("ws://127.0.0.1:{}/websocket", addr.port());
        tokio::spawn(server);

        (addr, state)
    }

    async fn connect_client(
        addr: &str,
    ) -> (
        futures::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            tokio_tungstenite::tungstenite::Message,
        >,
        futures::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
    ) {
        let (ws_stream, _) = connect_async(addr).await.expect("Failed to connect");
        ws_stream.split()
    }

    #[tokio::test]
    async fn test_websocket_connection() {
        let (addr, _) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        // Test initial connection with heartbeat
        let heartbeat = r#"[null,"1","phoenix","heartbeat",{}]"#;
        tx.send(Message::text(heartbeat)).await.unwrap();

        if let Some(Ok(msg)) = rx.next().await {
            let response: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(response[2], "phoenix");
            assert_eq!(response[4]["status"], "ok");
        }
    }

    // FIXME: not cleaned up
    //
    // #[tokio::test]
    // async fn test_channel_join_leave_flow() {
    //     let (addr, state) = setup_test_server().await;
    //     let (mut tx, mut rx) = connect_client(&addr).await;
    //
    //     // Join system channel
    //     let join_msg = r#"["1","ref1","system","phx_join",{"token":"test"}]"#;
    //     tx.send(Message::text(join_msg)).await.unwrap();
    //
    //     // Verify join response
    //     if let Some(Ok(msg)) = rx.next().await {
    //         let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
    //         assert_eq!(resp[1], "ref1");
    //         assert_eq!(resp[2], "system");
    //         assert_eq!(resp[4]["status"], "ok");
    //     }
    //
    //     // Leave channel
    //     let leave_msg = r#"["1","ref2","system","phx_leave",{}]"#;
    //     tx.send(Message::text(leave_msg)).await.unwrap();
    //
    //     // Verify leave response
    //     if let Some(Ok(msg)) = rx.next().await {
    //         let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
    //         assert_eq!(resp[1], "ref2");
    //         assert_eq!(resp[2], "system");
    //         assert_eq!(resp[4]["status"], "ok");
    //     }
    //
    //     // Verify channel state
    //     assert!(state
    //         .ctl
    //         .lock()
    //         .await
    //         .channel_map
    //         .lock()
    //         .await
    //         .get("system")
    //         .unwrap()
    //         .empty());
    // }
    //

    #[tokio::test]
    async fn test_flow_server() {
        let (_addr, state) = setup_test_server().await;

        let ctl = state.ctl.lock().await;
        let channels = ctl.channels.lock().await;

        let channel_names: HashSet<String> = channels.keys().cloned().collect();
        assert_eq!(
            channel_names,
            ["phoenix", "system", "streaming"]
                .iter()
                .map(|&s| s.to_string())
                .collect::<HashSet<String>>()
        );

        let agents = channels.get("system").unwrap().agents.lock().await;
        assert_eq!(agents.len(), 0);
    }

    #[tokio::test]
    async fn test_flow_join_leave() {
        let (addr, state) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        // Join system channel
        let join_msg = r#"["1","ref1","system","phx_join",{"token":"test"}]"#;
        tx.send(Message::text(join_msg)).await.unwrap();

        // Verify join response
        if let Some(Ok(msg)) = rx.next().await {
            let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(resp[1], "ref1");
            assert_eq!(resp[2], "system");
            assert_eq!(resp[3], "phx_reply".to_string());
            assert_eq!(resp[4]["status"], "ok");
        }

        {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            let agents = channels.get("system").unwrap().agents.lock().await;
            // 没法知道具体的 agent_id
            // assert_eq!(*agents, vec!["foobar"]);
            assert_eq!(agents.len(), 1);
        }

        // Leave channel
        let leave_msg = r#"["1","ref2","system","phx_leave",{}]"#;
        tx.send(Message::text(leave_msg)).await.unwrap();

        // Verify leave response
        if let Some(Ok(msg)) = rx.next().await {
            let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(resp[1], "ref2");
            assert_eq!(resp[2], "system");
            assert_eq!(resp[3], "phx_reply".to_string());
            assert_eq!(resp[4]["status"], "ok");
        }

        {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            let agents = channels.get("system").unwrap().agents.lock().await;
            assert_eq!(*agents, vec!["foobar"]);
            assert_eq!(agents.len(), 0);
        }
    }

    #[tokio::test]
    async fn test_multiple_clients() {
        let (addr, state) = setup_test_server().await;

        // Connect multiple clients
        let mut clients = vec![];
        assert_eq!(clients.len(), 0);

        for i in 0..3 {
            let (mut tx, mut rx) = connect_client(&addr).await;

            // Join system channel
            let join_msg = format!(
                r#"["{}","ref{}","system","phx_join",{{"token":"test"}}]"#,
                i, i
            );
            tx.send(Message::text(join_msg)).await.unwrap();

            // Verify join
            if let Some(Ok(msg)) = rx.next().await {
                let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
                assert_eq!(resp[4]["status"], "ok");
            }
            clients.push((tx, rx));
        }

        assert_eq!(clients.len(), 3);

        let ctl = state.ctl.lock().await;
        let channels = ctl.channels.lock().await;

        let channel_names: HashSet<String> = channels.keys().cloned().collect();
        assert_eq!(
            channel_names,
            ["phoenix", "system", "streaming"]
                .iter()
                .map(|&s| s.to_string())
                .collect::<HashSet<String>>()
        );

        let agents = channels.get("system").unwrap().agents.lock().await;
        assert_eq!(*agents, vec!["a".to_string()]);
    }

    #[tokio::test]
    async fn test_message_broadcast() {
        let (addr, state) = setup_test_server().await;
        let (mut tx1, mut rx1) = connect_client(&addr).await;
        let (mut tx2, mut rx2) = connect_client(&addr).await;

        // Both clients join system channel
        for (tx, i) in [(&mut tx1, 1), (&mut tx2, 2)] {
            let join_msg = format!(
                r#"["{}","ref{}","system","phx_join",{{"token":"test"}}]"#,
                i, i
            );
            tx.send(Message::text(join_msg)).await.unwrap();

            // Wait for join response
            if let Some(Ok(_)) = if i == 1 {
                rx1.next().await
            } else {
                rx2.next().await
            } {}
        }

        // Broadcast message to system channel
        let message = ReplyMessage {
            join_ref: None,
            event_ref: "broadcast".to_string(),
            topic: "system".to_string(),
            event: "test".to_string(),
            payload: ReplyPayload {
                status: "ok".to_string(),
                // response: json!({
                //     "message": "test broadcast".to_string(),
                // }),
                response: Response::Message {
                    message: "test broadcast".to_string(),
                },
            },
        };

        state
            .ctl
            .lock()
            .await
            .channel_broadcast("system".to_string(), ChannelMessage::Reply(message))
            .await
            .unwrap();

        // Both clients should receive the message
        for rx in [&mut rx1, &mut rx2] {
            if let Some(Ok(msg)) = rx.next().await {
                let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
                assert_eq!(resp[1], "broadcast");
                assert_eq!(resp[4]["response"]["message"], "test broadcast");
            }
        }
    }

    // FIXME: not cleaned up
    //
    // #[tokio::test]
    // async fn test_connection_close() {
    //     let (addr, state) = setup_test_server().await;
    //     let (mut tx, mut rx) = connect_client(&addr).await;
    //
    //     let join_msg = r#"["1","ref1","system","phx_join",{"token":"test"}]"#;
    //     tx.send(Message::text(join_msg)).await.unwrap();
    //     rx.next().await;
    //
    //     drop(tx);
    //     drop(rx);
    //
    //     tokio::time::sleep(Duration::from_millis(100)).await;
    //     assert!(state
    //         .ctl
    //         .lock()
    //         .await
    //         .channel_map
    //         .lock()
    //         .await
    //         .get("system")
    //         .unwrap()
    //         .empty());
    // }

    #[tokio::test]
    async fn test_invalid_messages() {
        let (addr, _) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        // Send invalid JSON
        tx.send(Message::text("invalid json")).await.unwrap();

        // Send invalid message format
        tx.send(Message::text(r#"["invalid","format"]"#))
            .await
            .unwrap();

        // Send to non-existent channel
        let invalid_channel = r#"["1","ref1","nonexistent","phx_join",{"token":"test"}]"#;
        tx.send(Message::text(invalid_channel)).await.unwrap();

        // Connection should still be alive
        let heartbeat = r#"[null,"1","phoenix","heartbeat",{}]"#;
        tx.send(Message::text(heartbeat)).await.unwrap();

        if let Some(Ok(msg)) = rx.next().await {
            let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(resp[2], "phoenix");
            assert_eq!(resp[4]["status"], "ok");
        }
    }

    #[tokio::test]
    async fn test_system_channel() {
        let (addr, _) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        // Join system channel
        let join_msg = r#"["1","ref1","system","phx_join",{"token":"test"}]"#;
        tx.send(Message::text(join_msg)).await.unwrap();

        // Should receive initial join response
        if let Some(Ok(msg)) = rx.next().await {
            let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(resp[2], "system");
            assert_eq!(resp[4]["status"], "ok");
        }

        // Should receive datetime updates
        if let Some(Ok(msg)) = rx.next().await {
            let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(resp[2], "system");
            assert!(resp[4]["response"]["datetime"].is_string());
        }
    }

    // #[test]
    // fn test_response_invalid_json() {
    //     // Missing type field
    //     let json = r#"{"message": "hello"}"#;
    //     assert!(serde_json::from_str::<RedisResponse>(json).is_err());
    //
    //     // Invalid type value
    //     let json = r#"{"type": "invalid"}"#;
    //     assert!(serde_json::from_str::<RedisResponse>(json).is_err());
    //
    //     // Missing required fields
    //     let json = r#"{"type": "datetime", "datetime": "2024-01-01"}"#;
    //     assert!(serde_json::from_str::<RedisResponse>(json).is_err());
    // }

    #[test]
    fn test_request_json_heartbeat() {
        // Test full message with join payload
        let msg: RequestMessage =
            serde_json::from_str(r#"["1", "ref1", "room123", "heartbeat", {}]"#).unwrap();

        assert_eq!(msg.join_ref, Some("1".to_string()));
        assert_eq!(msg.event_ref, "ref1");
        assert_eq!(msg.topic, "room123");
        assert_eq!(msg.event, "heartbeat");
        assert_eq!(msg.payload, serde_json::from_value(json!({})).unwrap());
    }

    #[test]
    fn test_request_json_join() {
        // Test full message with join payload
        let msg: RequestMessage = serde_json::from_str(
            r#"["1", "ref1", "room123", "phx_join", {"token": "secret_token"}]"#,
        )
        .unwrap();

        assert_eq!(msg.join_ref, Some("1".to_string()));
        assert_eq!(msg.event_ref, "ref1");
        assert_eq!(msg.topic, "room123");
        assert_eq!(msg.event, "phx_join");
        assert_eq!(
            msg.payload,
            RequestPayload::Join {
                token: "secret_token".to_string()
            }
        );
    }

    #[test]
    fn test_request_json_message() {
        let json = r#"["1", "ref4", "room123", "message", {"message": "Hello, World!"}]"#;

        let msg: RequestMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.event, "message");
        assert_eq!(
            msg.payload,
            RequestPayload::Message {
                message: "Hello, World!".to_string()
            }
        );

        // Test just the payload
        // let payload: RequestPayload = serde_json::from_value(json!({"message": "test message"})).unwrap();
        // assert_eq!(payload, RequestPayload::Message("test message".to_string()));
    }

    #[test]
    fn test_request_json_message_payload() {
        let payload: RequestPayload = serde_json::from_value(json!({})).unwrap();
        assert_eq!(payload, RequestPayload::JsonValue(json!({})));

        let payload: RequestPayload =
            serde_json::from_value(json!({"token": "another_token"})).unwrap();
        assert_eq!(
            payload,
            RequestPayload::Join {
                token: "another_token".to_string()
            }
        );

        let payload: RequestPayload =
            serde_json::from_value(json!({ "message": "test message" })).unwrap();
        assert_eq!(
            payload,
            RequestPayload::Message {
                message: "test message".to_string()
            }
        );
    }

    #[test]
    fn test_request_json_invalid() {
        // Invalid array length
        assert!(serde_json::from_str::<RequestMessage>(r#"["1", "ref1", "room123"]"#).is_err());
        assert!(
            serde_json::from_str::<RequestMessage>(r#"["1", "ref1", "room123", "phx_join"]"#)
                .is_err()
        );

        // Invalid join payload (wrong format)
        assert!(serde_json::from_str::<RequestMessage>(
            r#"["1", "ref1", "room123", "phx_join", null]"#
        )
        .is_ok());
        assert!(serde_json::from_str::<RequestMessage>(
            r#"["1", "ref1", "room123", "phx_join", 23]"#
        )
        .is_ok());
        assert!(serde_json::from_str::<RequestMessage>(
            r#"["1", "ref1", "room123", "phx_join", 12.4]"#
        )
        .is_ok());
        assert!(serde_json::from_str::<RequestMessage>(
            r#"["1", "ref1", "room123", "phx_join", "nulldirect_token"]"#
        )
        .is_ok());
        assert!(serde_json::from_str::<RequestMessage>(
            r#"["1", "ref1", "room123", "phx_join", [1, null, "foobar"]]"#
        )
        .is_ok());

        // Invalid type for number elements
        assert!(serde_json::from_str::<RequestMessage>(
            r#"[123, "ref1", "room123", "phx_join", {"token": "secret"}]"#
        )
        .is_err());
    }
}

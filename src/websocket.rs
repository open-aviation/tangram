use futures::stream::SplitSink;
use futures::SinkExt;
use futures::StreamExt;
use std::fmt::{Display, Error};
use std::sync::Arc;
use tokio::task::JoinHandle;
use warp::filters::ws::Message;

use futures::stream::SplitStream;
use redis::Client;
use serde::{Deserialize, Serialize};
use serde_tuple::{Deserialize_tuple, Serialize_tuple};
use tokio::sync::Mutex;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tracing::{debug, error, info};
use uuid::Uuid;
use warp::filters::ws::WebSocket;

use crate::channel::{ChannelControl, ChannelMessage};

/// reply data structures
#[derive(Clone, Debug, Serialize_tuple)]
pub struct ReplyMessage {
    pub join_reference: Option<String>, // null when it's heartbeat
    pub reference: String,
    pub topic: String, // `channel`
    pub event: String,
    pub payload: ReplyPayload,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReplyPayload {
    pub status: String,
    pub response: Response,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum Response {
    Empty {},
    Join {},
    Heartbeat {},
    Datetime { datetime: String, counter: u32 },
    Message { message: String },
}

// request data structures
// RequestMessage is a message from client through websocket
// it's deserialized from a JSON array
#[derive(Debug, Deserialize_tuple)]
struct RequestMessage {
    join_reference: Option<String>, // null when it's heartbeat
    reference: String,
    topic: String, // `channel`
    event: String,
    _payload: RequestPayload,
}

impl Display for RequestMessage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> Result<(), Error> {
        write!(
            formatter,
            "<RequestMessage: join_ref={:?}, ref={}, topic={}, event={}, payload=...>",
            self.join_reference, self.reference, self.topic, self.event
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RequestPayload {
    // Join { token: String },
    Leave {},
    Heartbeat {},
}

pub struct State {
    pub ctl: Mutex<ChannelControl>,
    pub redis_url: String,
}

pub async fn on_connected(ws: WebSocket, state: Arc<State>) {
    let conn_id = Uuid::new_v4().to_string(); // 服务端生成的，内部使用
    info!("on_connected, new client: {}", conn_id);

    state.ctl.lock().await.add_connection(conn_id.clone()).await;

    let (ws_tx, ws_rx) = ws.split();

    // spawn a taks to forward conn mpsc to websocket
    let mut ws_tx_task = tokio::spawn(websocket_tx(conn_id.clone(), state.clone(), ws_tx));
    // let mut redis_subscribe_task =
    //     tokio::spawn(subscrisbe_redis(conn_id.clone(), state.clone(), ws_tx));

    // a task is created when handling joining event
    let mut ws_rx_task = tokio::spawn(handle_events(ws_rx, state.clone(), conn_id.clone()));

    tokio::select! {
        _ = (&mut ws_tx_task) => ws_rx_task.abort(),
        // _ = (&mut redis_subscribe_task) => ws_rx_task.abort(),
        _ = (&mut ws_rx_task) => ws_tx_task.abort(),
    }

    state
        .ctl
        .lock()
        .await
        .remove_agent(conn_id.to_string())
        .await;
    info!("client connection closed");
}

async fn handle_join_event(
    rm: &RequestMessage,
    _ws_rx: &mut SplitStream<WebSocket>,
    state: Arc<State>,
    conn_id: &str,
) -> JoinHandle<()> {
    let channel_name = &rm.topic; // ?

    let agent_id = format!("{}:{}", conn_id, rm.join_reference.clone().unwrap());
    info!("{} joining {} ...", agent_id, channel_name.clone(),);
    state
        .ctl
        .lock()
        .await
        .add_agent(agent_id.to_string(), None)
        .await;
    state
        .ctl
        .lock()
        .await
        .join_channel(&channel_name.clone(), agent_id.to_string())
        .await
        .unwrap();
    // task to forward from agent broadcast to conn
    // let local_state = state.clone();
    let channel_forward_task = tokio::spawn(agent_rx_to_conn(
        state.clone(),
        rm.join_reference.clone().unwrap(),
        agent_id.clone(),
        conn_id.to_string(),
    ));
    reply_ok_with_empty_response(
        conn_id.to_string().clone(),
        rm.join_reference.clone(),
        &rm.reference,
        channel_name,
        state.clone(),
    )
    .await;
    channel_forward_task
}

async fn agent_rx_to_conn(state: Arc<State>, join_ref: String, agent_id: String, conn_id: String) {
    let mut agent_rx = state
        .ctl
        .lock()
        .await
        .get_agent_subscription(agent_id.clone())
        .await
        .unwrap();
    let conn_tx = state
        .ctl
        .lock()
        .await
        .get_conn_sender(conn_id.clone())
        .await
        .unwrap();
    debug!(
        "forward agent {} to conn {} ...",
        agent_id.clone(),
        conn_id.clone()
    );
    while let Ok(mut channel_message) = agent_rx.recv().await {
        if let ChannelMessage::Reply(ref mut reply_message) = channel_message {
            reply_message.join_reference = Some(join_ref.clone());
            let result = conn_tx.send(channel_message.clone());
            if result.is_err() {
                error!("sending failure: {:?}", result.err().unwrap());
                break; // fails when there's no reciever, stop forwarding
            }
            debug!("F {:?}", channel_message);
        }
    }
}

async fn handle_events(mut ws_rx: SplitStream<WebSocket>, state: Arc<State>, conn_id: String) {
    info!("handle events ...");
    while let Some(Ok(m)) = ws_rx.next().await {
        if !m.is_text() {
            continue;
        }
        info!("input: `{}`", m.to_str().unwrap());
        let rm_result = serde_json::from_str(m.to_str().unwrap());
        if rm_result.is_err() {
            error!("error: {}", rm_result.err().unwrap());
            continue;
        }
        let rm: RequestMessage = rm_result.unwrap();

        let reference = &rm.reference;
        let join_reference = &rm.join_reference;
        let channel = &rm.topic;
        let event = &rm.event;

        if channel == "phoenix" && event == "heartbeat" {
            debug!("heartbeat message");
            reply_ok_with_empty_response(
                conn_id.clone(),
                None,
                reference,
                "phoenix",
                state.clone(),
            )
            .await;
        }

        if event == "phx_join" {
            let _channel_foward_task =
                handle_join_event(&rm, &mut ws_rx, state.clone(), &conn_id).await;
        }

        if event == "phx_leave" {
            state
                .ctl
                .lock()
                .await
                .leave_channel(channel.clone(), conn_id.to_string())
                .await
                .unwrap();
            reply_ok_with_empty_response(
                conn_id.clone(),
                join_reference.clone(),
                reference,
                channel,
                state.clone(),
            )
            .await;
        }
    }
}

async fn _redis_relay(
    redis_url: String,
    redis_topic: String,
    mut ws_tx: SplitSink<WebSocket, Message>,
) -> redis::RedisResult<()> {
    let redis_client = Client::open(redis_url.clone())?;

    let mut redis_pubsub = redis_client.get_async_pubsub().await?;
    redis_pubsub.subscribe(redis_topic.clone()).await?;

    let mut redis_pubsub_stream = redis_pubsub.on_message();

    info!("listening to {} pubsub: `{}` ...", redis_url, redis_topic);
    loop {
        match redis_pubsub_stream.next().await {
            Some(stream_message) => {
                let payload: String = stream_message.get_payload()?;
                info!("received: {}", payload);

                // Redis string => Message
                let result = ws_tx.send(warp::ws::Message::text(payload)).await;
                if result.is_err() {
                    error!("receiver dropped, exiting: {}", result.err().unwrap());
                    break; //
                }
            }
            None => {
                info!("PubSub connection closed, exiting.");
                break;
            }
        }
    }

    Ok(())
}

async fn websocket_tx(
    conn_id: String,
    state: Arc<State>,
    mut ws_tx: SplitSink<WebSocket, Message>,
) {
    debug!("launch websocket sender ...");
    // let redis_relay_task = tokio::spawn(redis_relay(state.redis_url, conn_id.clone(), ws_tx));

    let mut conn_rx = state
        .ctl
        .lock()
        .await
        .get_conn_subscription(conn_id.to_string())
        .await
        .unwrap();

    while let Ok(channel_message) = conn_rx.recv().await {
        if let ChannelMessage::Reply(reply_message) = channel_message {
            let text = serde_json::to_string(&reply_message).unwrap();
            let result = ws_tx.send(warp::ws::Message::text(text)).await;
            if result.is_err() {
                error!("sending failure: {:?}", result);
                continue;
            }
        }
    }
}

async fn reply_ok_with_empty_response(
    conn_id: String,
    join_ref: Option<String>,
    event_ref: &str,
    channel_name: &str,
    state: Arc<State>,
) {
    let join_reply_message = ReplyMessage {
        join_reference: join_ref.clone(),
        reference: event_ref.to_string(),
        topic: channel_name.to_string(),
        event: "phx_reply".to_string(),
        payload: ReplyPayload {
            status: "ok".to_string(),
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
        .send_to_connction(
            conn_id.to_string(),
            ChannelMessage::Reply(join_reply_message),
        )
        .await
        .unwrap();
    debug!("sent to connection {}: {}", conn_id.clone(), text);
}

pub async fn streaming_default_tx_task(
    local_state: Arc<State>,
    mut rx: UnboundedReceiverStream<String>,
    channel_name: &str,
    event_name: &str,
) {
    info!("launch data task ...");
    let mut counter = 0;
    while let Some(message) = rx.next().await {
        let reply_message = ReplyMessage {
            join_reference: None,
            reference: counter.to_string(),
            topic: channel_name.to_string(),
            event: event_name.to_string(),
            payload: ReplyPayload {
                status: "ok".to_string(),
                response: Response::Message { message },
            },
        };
        // unexpected error: Error("can only flatten structs and maps (got a integer)", line: 0, column: 0)
        let serialized_result = serde_json::to_string(&reply_message);
        if serialized_result.is_err() {
            error!("error: {}", serialized_result.err().unwrap());
            continue;
        }
        let text = serialized_result.unwrap();
        match local_state
            .ctl
            .lock()
            .await
            .broadcast(
                channel_name.to_string(),
                ChannelMessage::Reply(reply_message),
            )
            .await
        {
            Ok(_) => {
                counter += 1;
                debug!("{} > {}", event_name, text);
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
}

// 每秒发送一个时间戳
pub async fn system_default_tx_task(state: Arc<State>, channel_name: &str) {
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

    info!("launch system/datetime task...");
    let mut counter = 0;
    let event = "datetime";
    loop {
        let now = chrono::Local::now();
        let message = ReplyMessage {
            join_reference: None,
            reference: counter.to_string(),
            topic: channel_name.to_string(),
            event: event.to_string(),
            payload: ReplyPayload {
                status: "ok".to_string(),
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
            .broadcast(channel_name.to_string(), ChannelMessage::Reply(message))
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
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;
    use warp::Filter;

    async fn setup_test_server() -> (String, Arc<State>) {
        let state = Arc::new(State {
            ctl: Mutex::new(ChannelControl::new()),
            redis_url: "redis://localhost".to_string(),
        });

        // Setup channels
        state
            .ctl
            .lock()
            .await
            .new_channel("phoenix".into(), None)
            .await;
        state
            .ctl
            .lock()
            .await
            .new_channel("system".into(), None)
            .await;
        state
            .ctl
            .lock()
            .await
            .new_channel("streaming".into(), None)
            .await;

        // Spawn system task
        tokio::spawn(system_default_tx_task(state.clone(), "system"));

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

    #[tokio::test]
    async fn test_multiple_clients() {
        let (addr, state) = setup_test_server().await;

        // Connect multiple clients
        let mut clients = vec![];
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

        assert_eq!(
            state
                .ctl
                .lock()
                .await
                .channel_map
                .lock()
                .await
                .get("system")
                .unwrap()
                .count
                .load(std::sync::atomic::Ordering::SeqCst),
            3
        );
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
            join_reference: None,
            reference: "broadcast".to_string(),
            topic: "system".to_string(),
            event: "test".to_string(),
            payload: ReplyPayload {
                status: "ok".to_string(),
                response: Response::Message {
                    message: "test broadcast".to_string(),
                },
            },
        };

        state
            .ctl
            .lock()
            .await
            .broadcast("system".to_string(), ChannelMessage::Reply(message))
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
}

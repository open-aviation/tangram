use super::utils::decode_jwt;
use super::{listen_to_redis, Channel, ChannelControl, ChannelError, ChannelMessage};
use bytes::Bytes;
use futures::SinkExt;
use futures::StreamExt;
use itertools::Itertools;
use redis::aio::MultiplexedConnection;
use redis::AsyncCommands;
use redis::RedisResult;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_tuple::{Deserialize_tuple, Serialize_tuple};
use std::collections::HashMap;
use std::convert::TryFrom;
use std::fmt;
use std::fmt::{Display, Error};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, instrument, warn, Instrument};

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opcode {
    Push = 0,
    Reply = 1,
    Broadcast = 2,
}

impl TryFrom<u8> for Opcode {
    type Error = u8;

    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(Opcode::Push),
            1 => Ok(Opcode::Reply),
            2 => Ok(Opcode::Broadcast),
            _ => Err(v),
        }
    }
}

/// Phoenix V2 Protocol Message (Server -> Client).
///
/// Serialises to a JSON array: `[join_ref, ref, topic, event, payload]`.
///
/// Matches `Phoenix.Socket.Message` V2 serialization format.
#[derive(Clone, Debug, Serialize_tuple)]
pub struct ServerMessage {
    // Opcode is not part of the JSON array body, handled at frame level.
    #[serde(skip)]
    pub opcode: Opcode,
    pub join_ref: Option<String>,
    pub event_ref: String,
    pub topic: String,
    pub event: String,
    pub payload: ServerPayload,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum ServerPayload {
    ServerResponse(ServerResponse),
    ServerJsonValue(serde_json::Value),
    #[serde(serialize_with = "serialize_bytes_as_array")]
    Binary(Bytes),
}

/// Custom serializer for Bytes to serialize as a JSON array of bytes if forced to JSON.
fn serialize_bytes_as_array<S>(bytes: &Bytes, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_bytes(bytes)
}

impl ServerMessage {
    /// Encodes the message into the Phoenix V2 binary push format (Server -> Client).
    ///
    /// - Push (0): `<< 0, join_ref_len, topic_len, event_len, join_ref, topic, event, data >>`
    /// - Reply (1): `<< 1, join_ref_len, ref_len, topic_len, status_len, join_ref, ref, topic, status, data >>`
    /// - Broadcast (2): `<< 2, topic_len, event_len, topic, event, data >>`
    pub fn to_binary_frame(&self) -> Bytes {
        let ServerPayload::Binary(ref data) = self.payload else {
            panic!("to_binary_frame called on non-binary payload");
        };

        let join_ref = self.join_ref.as_deref().unwrap_or("");

        let mut out = Vec::with_capacity(64 + data.len());

        out.push(self.opcode as u8);

        match self.opcode {
            Opcode::Push => {
                let join_ref_len = join_ref.len() as u8;
                let topic_len = self.topic.len() as u8;
                let event_len = self.event.len() as u8;

                out.push(join_ref_len);
                out.push(topic_len);
                out.push(event_len);
                out.extend_from_slice(join_ref.as_bytes());
                out.extend_from_slice(self.topic.as_bytes());
                out.extend_from_slice(self.event.as_bytes());
            }
            Opcode::Reply => {
                let ref_val = &self.event_ref;
                let status = &self.event;

                let join_ref_len = join_ref.len() as u8;
                let ref_len = ref_val.len() as u8;
                let topic_len = self.topic.len() as u8;
                let status_len = status.len() as u8;

                out.push(join_ref_len);
                out.push(ref_len);
                out.push(topic_len);
                out.push(status_len);
                out.extend_from_slice(join_ref.as_bytes());
                out.extend_from_slice(ref_val.as_bytes());
                out.extend_from_slice(self.topic.as_bytes());
                out.extend_from_slice(status.as_bytes());
            }
            Opcode::Broadcast => {
                let topic_len = self.topic.len() as u8;
                let event_len = self.event.len() as u8;

                out.push(topic_len);
                out.push(event_len);
                out.extend_from_slice(self.topic.as_bytes());
                out.extend_from_slice(self.event.as_bytes());
            }
        }

        out.extend_from_slice(data);
        Bytes::from(out)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ServerResponse {
    pub status: String,
    pub response: Response,
}

/// Standard Phoenix Reply Payloads
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Response {
    #[serde(rename = "join")]
    Join { id: String },

    #[serde(rename = "heartbeat")]
    Heartbeat {},

    #[serde(rename = "datetime")]
    Datetime { datetime: String, counter: u32 },

    #[serde(rename = "message")]
    Message { message: String },

    #[serde(rename = "null")]
    Empty {},
}

impl fmt::Display for ServerMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let join_ref = self.join_ref.clone().unwrap_or("None".to_string());

        let payload_display = match &self.payload {
            ServerPayload::ServerResponse(resp) => {
                format!("<Payload status={}, response=...>", resp.status)
            }
            ServerPayload::ServerJsonValue(value) => format!("<ServerJsonResponse {}>", value),
            ServerPayload::Binary(data) => format!("<Binary len={}>", data.len()),
        };
        write!(
            f,
            "Message join_ref={}, ref={}, topic={}, event={}, {}",
            join_ref, self.event_ref, self.topic, self.event, payload_display
        )
    }
}

/// Phoenix V2 Protocol Message (client -> server).
///
/// Deserialises from `[join_ref, ref, topic, event, payload]`.
#[derive(Debug, Deserialize_tuple)]
struct RequestMessage {
    join_ref: Option<String>,
    event_ref: String,
    topic: String,
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
    JsonValue(serde_json::Value),
}

/// Global Application State passed to Axum handlers.
pub struct State {
    pub ctl: Mutex<ChannelControl>,
    pub redis_client: redis::Client,
    pub id_length: u8,
    pub jwt_secret: String,
    pub jwt_expiration_secs: i64,
}

/// Main Websocket Upgrade Handler.
///
/// Roughly equivalent to `Phoenix.Endpoint.socket/3` + `Phoenix.Socket.connect/2` + process loop.
///
/// 1. Establishes connection ID.
/// 2. Spawns `ws_tx_task`: Reads from `conn_tx` (mpsc) -> Writes to Websocket.
/// 3. Spawns `ws_rx_task`: Reads from Websocket -> Calls `handle_message`.
/// 4. Waits for either to finish (connection close).
/// 5. Calls `conn_cleanup`.
#[instrument(skip(ws, state, user_token))]
pub async fn axum_on_connected(
    ws: axum::extract::ws::WebSocket,
    state: Arc<State>,
    user_token: Option<String>,
) {
    info!("params: {:?}", user_token);

    let conn_id = nanoid::nanoid!(8).to_string();
    state.ctl.lock().await.conn_add_tx(conn_id.clone()).await;
    info!("new connection connected: {}", conn_id);

    let (mut ws_tx, mut ws_rx) = ws.split();

    // connection broadcast channel -> websocket frame
    let ws_tx_state = state.clone();
    let ws_tx_conn_id = conn_id.clone();
    let span_tx = tracing::info_span!("ws_tx");
    let mut ws_tx_task = tokio::spawn(
        async move {
            info!("launch websocket tx task (conn rx => ws tx) ...");

            let mut conn_rx = ws_tx_state
                .ctl
                .lock()
                .await
                .conn_rx(ws_tx_conn_id.clone())
                .await
                .unwrap();
            loop {
                match conn_rx.recv().await {
                    Ok(channel_message) => {
                        let ChannelMessage::Reply(reply_message) = channel_message;

                        match reply_message.payload {
                            ServerPayload::Binary(_) => {
                                let frame = reply_message.to_binary_frame();
                                if let Err(e) = ws_tx
                                    .send(axum::extract::ws::Message::Binary(frame))
                                    .await
                                {
                                    error!(error = %e, "websocket tx sending binary failed");
                                    break;
                                }
                            }
                            _ => {
                                let text_result = serde_json::to_string(&reply_message);
                                if let Ok(text) = text_result {
                                    if let Err(e) = ws_tx
                                        .send(axum::extract::ws::Message::Text(text.into()))
                                        .await
                                    {
                                        error!(error = %e, "websocket tx sending failed");
                                        break;
                                    }
                                } else {
                                    error!(error = %text_result.err().unwrap(), "fail to serialize reply");
                                    break;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!(error = ?e, "rx error");
                        break;
                    }
                }
            }
        }
        .instrument(span_tx),
    );

    // websocket frame -> redis / control logic
    let ws_rx_state = state.clone();
    let ws_rx_conn_id = conn_id.clone();
    let ws_rx_user_token = user_token.clone();
    let span_rx = tracing::info_span!("ws_rx");
    let mut ws_rx_task = tokio::spawn(
        async move {
            info!("websocket rx handling (ws rx =>) ...");
            let mut redis_conn = ws_rx_state
                .redis_client
                .get_multiplexed_async_connection()
                .await
                .unwrap();

            // Read all messages from websocket rx, process or dispatch to each channel
            while let Some(msg_result) = ws_rx.next().await {
                match msg_result {
                    Ok(msg) => match msg {
                        axum::extract::ws::Message::Text(text) => {
                            if let Err(e) = handle_text_message(
                                ws_rx_state.clone(),
                                ws_rx_user_token.clone(),
                                &ws_rx_conn_id,
                                &text,
                                &mut redis_conn,
                            )
                            .await
                            {
                                error!(error = ?e, "handle_text_message error");
                            }
                        }
                        axum::extract::ws::Message::Binary(bin) => {
                            if let Err(e) =
                                handle_binary_message(ws_rx_state.clone(), &bin, &mut redis_conn)
                                    .await
                            {
                                error!(error = ?e, "handle_binary_message error");
                            }
                        }
                        axum::extract::ws::Message::Close(_) => {
                            debug!("close frame received");
                            break;
                        }
                        // TODO: handle ping/pong
                        _ => {}
                    },
                    Err(e) => {
                        error!(error = ?e, "rx error");
                        break;
                    }
                }
            }
        }
        .instrument(span_rx),
    );

    // Fault Isolation: If either task fails/exits, abort the other to clean up.
    tokio::select! {
        _ = (&mut ws_tx_task) => {
            ws_rx_task.abort();
        },
        _ = (&mut ws_rx_task) => {
            ws_tx_task.abort();
        },
    }

    state.ctl.lock().await.conn_cleanup(conn_id.clone()).await;
    info!("connection closed");
}

/// Parses Phoenix V2 binary push format (Client -> Server)
/// Format (Push): `<< 0, join_ref_len::8, ref_len::8, topic_len::8, event_len::8, join_ref, ref, topic, event, data >>`
async fn handle_binary_message(
    _state: Arc<State>,
    data: &[u8],
    redis_conn: &mut redis::aio::MultiplexedConnection,
) -> RedisResult<()> {
    if data.len() < 5 {
        error!("binary message too short header");
        return Ok(());
    }

    let opcode_u8 = data[0];
    let Ok(opcode) = Opcode::try_from(opcode_u8) else {
        error!("unsupported binary opcode: {}", opcode_u8);
        return Ok(());
    };

    if opcode != Opcode::Push {
        // phoenix clients typically use Push (0) to send binary data.
        // for now, only Push is implemented as per specs.
        error!("unsupported binary opcode from client: {:?}", opcode);
        return Ok(());
    }

    let join_ref_len = data[1] as usize;
    let ref_len = data[2] as usize;
    let topic_len = data[3] as usize;
    let event_len = data[4] as usize;

    let Some(header_content_len) = join_ref_len
        .checked_add(ref_len)
        .and_then(|n| n.checked_add(topic_len))
        .and_then(|n| n.checked_add(event_len))
    else {
        error!("binary message length overflow");
        return Ok(());
    };

    let Some(needed) = (5_usize).checked_add(header_content_len) else {
        error!("binary message total length overflow");
        return Ok(());
    };

    if data.len() < needed {
        error!(
            data_len = data.len(),
            needed = needed,
            "binary message too short body"
        );
        return Ok(());
    }

    let cursor = 5usize;
    // skip join_ref and ref for now, as we just forward payload.
    // in a full implementation we might need `ref` to construct a reply.
    let cursor = cursor
        .checked_add(join_ref_len)
        .and_then(|n| n.checked_add(ref_len))
        .unwrap();

    let topic_end = cursor.checked_add(topic_len).unwrap();
    let Ok(topic) = std::str::from_utf8(&data[cursor..topic_end]) else {
        error!("binary message topic not utf8");
        return Ok(());
    };

    let event_end = topic_end.checked_add(event_len).unwrap();
    let Ok(event) = std::str::from_utf8(&data[topic_end..event_end]) else {
        error!("binary message event not utf8");
        return Ok(());
    };

    let payload = &data[event_end..];

    let redis_topic = format!("from:{}:{}", topic, event);
    if let Err(e) = redis_conn.publish::<_, _, ()>(redis_topic, payload).await {
        error!("fail to publish binary to redis: {}", e);
    }

    Ok(())
}

/// Dispatches incoming websocket messages.
///
/// Equivalent to the `Phoenix.Channel.Server` loop handling `handle_in/3`.
///
/// - `heartbeat`: Sends local reply.
/// - `phx_join`: Triggers `handle_join` (auth + subscription).
/// - `phx_leave`: Triggers `handle_leave` (unsubscription).
/// - Other events: Published directly to Redis `from:<channel>:<event>`.
#[instrument(skip(state, user_token, redis_conn, text), fields(conn_id = %conn_id))]
async fn handle_text_message(
    state: Arc<State>,
    user_token: Option<String>,
    conn_id: &str,
    text: &str,
    redis_conn: &mut redis::aio::MultiplexedConnection,
) -> RedisResult<()> {
    let rm_result = serde_json::from_str::<RequestMessage>(text);
    if rm_result.is_err() {
        error!(
            error = ?rm_result.err(),
            %text,
            "deserialization error"
        );
        return Ok(());
    }
    let rm: RequestMessage = rm_result.unwrap();
    let channel_name = &rm.topic;
    let join_ref = &rm.join_ref;
    let event_ref = &rm.event_ref;
    let event = &rm.event;
    let payload = &rm.payload;

    if channel_name == "phoenix" && event == "heartbeat" {
        // it continues to publish events to the Redis
        ok_reply(conn_id, None, event_ref, "phoenix", state.clone()).await;

        let message = format!(r#"{{"conn_id": "{}"}}"#, conn_id);
        publish_event(redis_conn, "from:phoenix:heartbeat".to_string(), message).await;
        // continue;
    }

    if event == "phx_join" {
        // If there is no channel, create one

        // Start a new relay task (agent rx => conn tx), needs to be cleared when agent leaves
        // Each join in the connection will generate this task; when the connection is broken, it will exit automatically
        let _relay_task = handle_join(user_token, &rm, state.clone(), conn_id).await;
        debug!("join processed");
        // continue;
    }

    if event == "phx_leave" {
        handle_leave(
            state.clone(),
            conn_id,
            join_ref.clone(),
            event_ref,
            channel_name.clone(),
        )
        .await;
        debug!("leave processed");
    }

    // all events are dispatched to redis
    let redis_topic = format!("from:{}:{}", channel_name, event.clone());
    let message = serde_json::to_string(&payload).unwrap();
    publish_event(redis_conn, redis_topic, message).await;
    Ok(())
}

async fn publish_event(
    redis_conn: &mut redis::aio::MultiplexedConnection,
    redis_topic: String,
    message: String,
) {
    let publish_result: RedisResult<String> = redis_conn
        .publish(redis_topic.clone(), message.clone())
        .await;
    if let Err(e) = publish_result {
        error!("fail to publish to redis: {}", e)
    }
}

pub fn is_special_channel(ch: &str) -> bool {
    let excludes: Vec<&str> = vec!["phoenix", "admin", "system"];
    excludes.contains(&ch)
}

#[instrument(skip(ctl))]
pub async fn add_channel(ctl: &Mutex<ChannelControl>, channel_name: String) {
    let ctl = ctl.lock().await;

    let mut channels = ctl.channels.lock().await;
    let channel_exists = channels.contains_key(&channel_name);
    if channel_exists {
        warn!("channel already exists");
    }

    channels
        .entry(channel_name.clone())
        .or_insert_with(|| Channel::new(channel_name.clone(), None));
    warn!("channel added");

    let channel_names = channels.keys().cloned().collect::<Vec<String>>();
    info!(
        channels_count = channel_names.len(),
        ?channel_names,
        "channel created"
    );

    let meta = json!({
        "channel": channel_name,
        "channels": channels.keys().cloned().collect::<Vec<String>>(),
    });
    ctl.pub_meta_event("channel".into(), "add".into(), meta)
        .await;
}

/// launch a tokio thread to listen to redis topic
/// For each channel, when the first agent connects, this thread is created, and when the last one leaves, it is destroyed
/// phoenix, system, admin: these 3 are created directly and always exist
#[instrument(skip(state, ctl, redis_client))]
pub async fn launch_channel_redis_listen_task(
    state: Arc<State>,
    ctl: &Mutex<ChannelControl>,
    channel_name: String,
    redis_client: redis::Client,
) {
    let ctl = ctl.lock().await;
    let mut channels = ctl.channels.lock().await;
    let channel: &mut Channel = channels.get_mut(&channel_name).unwrap();
    if channel.redis_listen_task.is_some() {
        return;
    }
    // Spawn a listener for this channel.
    // This task dies if Redis connection fails (no auto-reconnect implemented yet).
    channel.redis_listen_task = Some(tokio::spawn(listen_to_redis(
        state,
        channel.tx.clone(),
        redis_client,
        channel_name.clone(),
    )));
    info!("redis_listen_task launched");
}

/// Handles `phx_join` requests.
/// 1. Validates JWT.
/// 2. Creates/Finds Channel.
/// 3. Registers Agent.
/// 4. Spawns Relay Task (Agent -> Conn).
/// 5. Sends `phx_reply` (ok).
/// 6. Sends Presence State.
#[instrument(skip(user_token, rm, state), fields(channel = %rm.topic, join_ref = ?rm.join_ref))]
async fn handle_join(
    user_token: Option<String>,
    rm: &RequestMessage,
    state: Arc<State>,
    conn_id: &str,
) -> Result<JoinHandle<()>, ChannelError> {
    // First try to see if join payload contains token, then check user_token
    let token = match &rm.payload {
        RequestPayload::Join { token } => Ok(token.clone()),
        _ => user_token.ok_or_else(|| {
            error!(payload = ?rm.payload, "invalid payload");
            ChannelError::BadToken
        }),
    }?;
    let claims = match decode_jwt(&token, state.jwt_secret.clone()).await {
        Ok(claims) => claims,
        Err(e) => {
            error!(error = %e, %token, "fail to decode JWT");
            return Err(ChannelError::BadToken);
        }
    };

    debug!(?claims, "jwt claims");

    let channel_name = rm.topic.clone();
    if is_special_channel(&channel_name) {
        info!("channel is special, ignored");
    } else {
        add_channel(&state.ctl, channel_name.clone()).await;
        launch_channel_redis_listen_task(
            state.clone(),
            &state.ctl,
            channel_name.clone(),
            state.redis_client.clone(),
        )
        .await;
    }

    let agent_id = format!(
        "{}:{}:{}",
        conn_id,
        channel_name.clone(),
        rm.join_ref.clone().unwrap()
    );
    let join_ref = rm.join_ref.clone();
    let event_ref = rm.event_ref.clone();

    info!(%agent_id, "agent joining");
    state
        .ctl
        .lock()
        .await
        .agent_add(agent_id.to_string(), None)
        .await; // Agent is not created here
    match state
        .ctl
        .lock()
        .await
        .channel_join(
            &channel_name.clone(),
            agent_id.to_string(),
            claims.id.clone(),
        )
        .await
    {
        Ok(_) => {}
        Err(e) => {
            // What happens to relay task when connection is lost?
            error!(error = %e, "fail to join");
            return Err(e);
        }
    }

    // Forward messages from agent rx to conn tx
    // This needs to be ready before join is complete to avoid losing messages
    let relay_state = state.clone();
    let local_join_ref = rm.join_ref.clone();
    let local_conn_id = conn_id.to_string();
    let local_agent_id = agent_id.clone();
    let span_relay = tracing::info_span!("relay", agent_id = %local_agent_id);
    let relay_task = tokio::spawn(
        async move {
            let mut agent_rx = relay_state
                .ctl
                .lock()
                .await
                .agent_rx(local_agent_id.clone())
                .await
                .unwrap();
            let conn_tx = relay_state
                .ctl
                .lock()
                .await
                .conn_tx(local_conn_id.to_string())
                .await
                .unwrap();

            debug!("agent => conn established");
            loop {
                match agent_rx.recv().await {
                    Ok(mut channel_message) => {
                        let ChannelMessage::Reply(ref mut reply) = channel_message;
                        reply.join_ref = local_join_ref.clone();
                        // agent rx => conn tx => conn rx => ws tx
                        if conn_tx.send(channel_message.clone()).is_err() {
                            // fails when there's no reciever, connection lost, stop forwarding
                            debug!("connection closed, stopping relay");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(skipped, "agent rx lagged");
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("agent rx closed"); // expected during cleanup
                        break;
                    }
                }
            }
        }
        .instrument(span_relay),
    );

    // phx_reply, confirm join event
    ok_reply(
        conn_id,
        join_ref.clone(),
        &event_ref,
        &channel_name,
        state.clone(),
    )
    .await;
    info!("acked");

    if channel_name == "admin" {
        info!("handling admin initialization ...");
        let ctl = state.ctl.lock().await;
        let channels = ctl.channels.lock().await;
        for (name, channel) in channels.iter() {
            // let channel = channels.get(&channel_name).unwrap();
            let meta = json!({"channel": name, "agents": *channel.agents.lock().await});
            ctl.pub_meta_event("channel".into(), "list".into(), meta)
                .await;
        }
    }

    // presence state, to current agent
    presence_state(
        conn_id,
        join_ref.clone(),
        &event_ref,
        &channel_name,
        state.clone(),
    )
    .await;

    // presence diff, broadcast
    let mut redis_conn = state
        .redis_client
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    presence_diff(
        &mut redis_conn,
        channel_name.clone(),
        agent_id.clone(),
        claims.id.clone(),
        PresenceAction::Join,
    )
    .await;

    Ok(relay_task)
}

#[instrument(skip(state), fields(channel = %channel_name, join_ref = ?join_ref))]
async fn handle_leave(
    state: Arc<State>,
    conn_id: &str,
    join_ref: Option<String>,
    event_ref: &str,
    channel_name: String,
) {
    let agent_id = format!("{}:{}:{}", conn_id, channel_name, join_ref.clone().unwrap());
    let external_id_opt = state.ctl.lock().await.agent_rm(agent_id.clone()).await;
    let agent_count = state
        .ctl
        .lock()
        .await
        .channel_leave(channel_name.clone(), agent_id.clone())
        .await
        .unwrap();
    if agent_count == 0 && !is_special_channel(&channel_name) {
        state
            .ctl
            .lock()
            .await
            .channel_remove_if_empty(channel_name.clone())
            .await;
    }
    ok_reply(conn_id, join_ref, event_ref, &channel_name, state.clone()).await;

    if external_id_opt.is_none() {
        error!("agent not found");
        return;
    }
    info!("send presense_diff");
    let mut redis_conn = state
        .redis_client
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    presence_diff(
        &mut redis_conn,
        channel_name.clone(),
        agent_id.clone(),
        external_id_opt.unwrap(),
        PresenceAction::Leave,
    )
    .await;
}

async fn ok_reply(
    conn_id: &str,
    join_ref: Option<String>,
    event_ref: &str,
    channel_name: &str,
    state: Arc<State>,
) {
    let response = match join_ref {
        None => Response::Empty {}, // heartbeat
        Some(ref join_ref) => Response::Join {
            id: format!("{}:{}:{}", conn_id, channel_name, join_ref),
        }, // join
    };
    let join_reply_message = ServerMessage {
        opcode: Opcode::Reply,
        join_ref: join_ref.clone(),
        event_ref: event_ref.to_string(),
        topic: channel_name.to_string(),
        event: "phx_reply".to_string(),
        payload: ServerPayload::ServerResponse(ServerResponse {
            status: "ok".to_string(),
            response,
        }),
    };
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
    // let text = serde_json::to_string(&join_reply_message).unwrap();
    // debug!("sent to connection {}: {}", &conn_id, text);
}

async fn presence_state(
    conn_id: &str,
    join_ref: Option<String>,
    event_ref: &str,
    channel_name: &str,
    state: Arc<State>,
) {
    let hashed_agents = state
        .ctl
        .lock()
        .await
        .agents
        .lock()
        .await
        .iter()
        .filter(|(_, agent)| agent.channel == channel_name)
        .into_group_map_by(|(_, agent)| &agent.external_id)
        .into_iter()
        .map(|(external_id, group)| {
            (external_id.clone(), {
                json!({
                    "metas": group.into_iter()
                        .map(|(id, _)| json!({ "phx_ref": id }))
                        .collect::<Vec<_>>()
                })
            })
        })
        .collect::<HashMap<_, _>>();
    let reply = ServerMessage {
        opcode: Opcode::Reply,
        join_ref: join_ref.clone(),
        event_ref: event_ref.to_string(),
        topic: channel_name.to_string(),
        event: "presence_state".to_string(),
        payload: ServerPayload::ServerJsonValue(json!(hashed_agents)),
    };
    state
        .ctl
        .lock()
        .await
        .conn_send(conn_id.to_string(), ChannelMessage::Reply(reply))
        .await
        .unwrap();
    info!("sent");
}

#[derive(Debug)]
pub enum PresenceAction {
    Join,
    Leave,
}

#[instrument(skip(redis_conn, items))]
pub async fn presence_diff_many(
    redis_conn: &mut MultiplexedConnection,
    channel_name: String,
    action: PresenceAction,
    items: serde_json::Value,
) {
    let diff = match action {
        PresenceAction::Join => json!({"joins": items, "leaves": {}}),
        PresenceAction::Leave => json!({"joins": {}, "leaves": items}),
    };
    let redis_topic = format!("to:{}:presence_diff", channel_name);
    let message = serde_json::to_string(&diff).unwrap();
    let publish_result: RedisResult<String> = redis_conn
        .publish(redis_topic.clone(), message.clone())
        .await;
    if let Err(e) = publish_result {
        error!(error = %e, "fail to publish to redis");
    } else {
        info!(?action, "sent");
    }
}

/// broadcast presence_diff over redis
#[instrument(skip(redis_conn))]
pub async fn presence_diff(
    redis_conn: &mut MultiplexedConnection,
    channel_name: String,
    agent_id: String,
    external_id: String,
    action: PresenceAction,
) {
    let items = json!({
        external_id.clone(): {
            "metas": [
                {"phx_ref": agent_id.clone()}
            ],
        },
    });
    let diff = match action {
        PresenceAction::Join => json!({"joins": items, "leaves": {}}),
        PresenceAction::Leave => json!({"joins": {}, "leaves": items}),
    };
    let redis_topic = format!("to:{}:presence_diff", channel_name);
    let message = serde_json::to_string(&diff).unwrap();
    let publish_result: RedisResult<String> = redis_conn
        .publish(redis_topic.clone(), message.clone())
        .await;
    if let Err(e) = publish_result {
        error!(error = %e, "fail to publish to redis");
    } else {
        info!(?action, "sent");
    }
}

// Send a timestamp every second
#[instrument(skip(state))]
pub async fn datetime_handler(state: Arc<State>, channel_name: String) {
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

    info!("launch system/datetime task...");
    let mut counter = 0;
    loop {
        let now = chrono::Local::now();
        let message = ServerMessage {
            opcode: Opcode::Push,
            join_ref: None,
            event_ref: counter.to_string(),
            topic: channel_name.to_string(),
            event: "datetime".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Datetime {
                    datetime: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
                    counter,
                },
            }),
        };
        match state
            .ctl
            .lock()
            .await
            .channel_broadcast(channel_name.to_string(), ChannelMessage::Reply(message))
            .await
        {
            Ok(0) => {} // no client
            Ok(_) => {} // debug!("datetime > {}", text),
            Err(ChannelError::ChannelEmpty) => {}
            Err(e) => {
                error!(
                    error = %e,
                    "fail to broadcast"
                );
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        counter += 1;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::channel::utils::generate_jwt;
    use axum::{
        extract::{Query, State as AxumState, WebSocketUpgrade},
        response::IntoResponse,
        routing::get,
        Router,
    };
    use futures::{SinkExt, StreamExt};
    use serde::Deserialize;
    use serde_json::json;
    use std::sync::Arc;
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::Mutex;
    use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

    #[derive(Debug, Deserialize)]
    struct WebSocketParams {
        #[serde(rename = "userToken")]
        user_token: Option<String>,

        #[allow(dead_code)]
        #[serde(rename = "vsn")]
        version: Option<String>,
    }

    async fn axum_websocket_handler(
        ws: WebSocketUpgrade,
        Query(params): Query<WebSocketParams>,
        AxumState(state): AxumState<Arc<State>>,
    ) -> impl IntoResponse {
        let user_token = params.user_token.clone();
        ws.on_upgrade(move |socket| axum_on_connected(socket, state, user_token))
    }

    async fn setup_test_server() -> (String, Arc<State>, String) {
        let redis_url = "redis://127.0.0.1:6379".to_string();
        let redis_client = redis::Client::open(redis_url.clone()).unwrap();
        let channel_control = ChannelControl::new(Arc::new(redis_client.clone()));
        let state = Arc::new(State {
            ctl: Mutex::new(channel_control),
            redis_client,
            id_length: 8,
            jwt_secret: "secret".into(),
            jwt_expiration_secs: 3600,
        });

        // unique channel to prevent pub/sub collisions between parallel tests
        let rand_suffix = nanoid::nanoid!(8);
        let system_channel = format!("system_{}", rand_suffix);

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
            .channel_add(system_channel.clone(), None)
            .await;
        state
            .ctl
            .lock()
            .await
            .channel_add("streaming".into(), None)
            .await;

        tokio::spawn(datetime_handler(state.clone(), system_channel.clone()));

        let app = Router::new()
            .route("/websocket", get(axum_websocket_handler))
            .with_state(state.clone());

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let addr = format!("ws://127.0.0.1:{}/websocket", port);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        (addr, state, system_channel)
    }

    async fn connect_client(
        addr: &str,
    ) -> (
        futures::stream::SplitSink<
            WebSocketStream<MaybeTlsStream<TcpStream>>,
            tokio_tungstenite::tungstenite::Message,
        >,
        futures::stream::SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    ) {
        let (ws_stream, _) = connect_async(addr).await.expect("Failed to connect");
        ws_stream.split()
    }

    async fn gen_token(state: &Arc<State>, channel: &str, id: &str) -> String {
        generate_jwt(
            id.to_string(),
            channel.to_string(),
            state.jwt_secret.clone(),
            state.jwt_expiration_secs,
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn test_ws_sanity_check() {
        let (addr, state, sys_chan) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            assert!(channels.contains_key(&sys_chan));
        }

        // verify basic heartbeat
        let heartbeat = r#"[null,"1","phoenix","heartbeat",{}]"#;
        tx.send(Message::text(heartbeat)).await.unwrap();

        if let Some(Ok(msg)) = rx.next().await {
            let response: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(response[2], "phoenix");
            assert_eq!(response[4]["status"], "ok");
        }
    }

    #[tokio::test]
    async fn test_ws_channel_join_leave_flow() {
        let (addr, state, sys_chan) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;
        let token = gen_token(&state, &sys_chan, "user1").await;

        let join_msg = format!(
            r#"["1","ref1","{}","phx_join",{{"token":"{}"}}]"#,
            sys_chan, token
        );
        tx.send(Message::text(join_msg)).await.unwrap();

        // verify join confirmation
        let timeout = std::time::Duration::from_secs(5);
        let mut join_confirmed = false;

        // loop required to skip potential "presence_state" or "datetime" noise
        for _ in 0..10 {
            match tokio::time::timeout(timeout, rx.next()).await {
                Ok(Some(Ok(msg))) => {
                    let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
                    if resp[1] == "ref1" && resp[2] == sys_chan && resp[3] == "phx_reply" {
                        assert_eq!(resp[4]["status"], "ok");
                        join_confirmed = true;
                        break;
                    }
                }
                _ => panic!("error or timeout waiting for join"),
            }
        }
        assert!(join_confirmed, "join confirmation missing");

        // verify internal state (agent exists)
        {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            let agents = channels.get(&sys_chan).unwrap().agents.lock().await;
            assert_eq!(agents.len(), 1);
        }

        let leave_msg = format!(r#"["1","ref2","{}","phx_leave",{{}}]"#, sys_chan);
        tx.send(Message::text(leave_msg)).await.unwrap();

        // verify leave connection
        let mut leave_confirmed = false;
        for _ in 0..10 {
            match tokio::time::timeout(timeout, rx.next()).await {
                Ok(Some(Ok(msg))) => {
                    let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
                    if resp[1] == "ref2" && resp[3] == "phx_reply" {
                        assert_eq!(resp[4]["status"], "ok");
                        leave_confirmed = true;
                        break;
                    }
                }
                _ => panic!("error or timeout waiting for leave"),
            }
        }
        assert!(leave_confirmed, "leave confirmation missing");

        // verify cleanup
        {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            if let Some(channel) = channels.get(&sys_chan) {
                assert_eq!(channel.agents.lock().await.len(), 0);
            }
        }
    }

    #[tokio::test]
    async fn test_ws_connection_close_websocket() {
        let (addr, state, sys_chan) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        let token = gen_token(&state, &sys_chan, "user1").await;

        let join_msg = format!(
            r#"["1","ref1","{}","phx_join",{{"token":"{}"}}]"#,
            sys_chan, token
        );
        tx.send(Message::text(join_msg)).await.unwrap();

        if let Some(Ok(_)) = rx.next().await {}

        // give time for join to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        let agent_count = {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            if let Some(channel) = channels.get(&sys_chan) {
                channel.agents.lock().await.len()
            } else {
                0
            }
        };
        assert_eq!(agent_count, 1, "Agent should be joined");

        // close connection by dropping handles
        drop(tx);
        drop(rx);

        // allow cleanup
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        let agent_count = {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            if let Some(channel) = channels.get(&sys_chan) {
                channel.agents.lock().await.len()
            } else {
                0
            }
        };
        assert_eq!(
            agent_count, 0,
            "Agent should be removed after connection close"
        );
    }

    // multiple clients that doesn't depend on specific agent IDs
    #[tokio::test]
    async fn test_ws_multiple_clients() {
        let (addr, state, sys_chan) = setup_test_server().await;

        let mut clients = vec![];
        for i in 0..3 {
            let (mut tx, mut rx) = connect_client(&addr).await;

            let token = gen_token(&state, &sys_chan, &format!("user{}", i)).await;

            let join_msg = format!(
                r#"["{}","ref{}","{}","phx_join",{{"token":"{}"}}]"#,
                i, i, sys_chan, token
            );
            tx.send(Message::text(join_msg)).await.unwrap();

            if let Some(Ok(_)) = tokio::time::timeout(std::time::Duration::from_secs(2), rx.next())
                .await
                .unwrap()
            {}

            clients.push((tx, rx));
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let agent_count = {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            let system_channel = channels.get(&sys_chan).unwrap();
            let agents = system_channel.agents.lock().await;
            agents.len()
        };

        assert_eq!(agent_count, 3, "Should have 3 agents connected");

        drop(clients);
    }

    #[tokio::test]
    async fn test_ws_message_broadcast() {
        let (addr, state, sys_chan) = setup_test_server().await;
        let (mut tx1, mut rx1) = connect_client(&addr).await;
        let (mut tx2, mut rx2) = connect_client(&addr).await;

        for (tx, i) in [(&mut tx1, 1), (&mut tx2, 2)] {
            let token = gen_token(&state, &sys_chan, &format!("user{}", i)).await;
            let join_msg = format!(
                r#"["{}","ref{}","{}","phx_join",{{"token":"{}"}}]"#,
                i, i, sys_chan, token
            );
            tx.send(Message::text(join_msg)).await.unwrap();
            // consume join reply to flush buffer
            rx1.next().await;
        }

        // simulate internal broadcast
        let message = ServerMessage {
            opcode: Opcode::Broadcast,
            join_ref: None,
            event_ref: "broadcast".to_string(),
            topic: sys_chan.clone(),
            event: "test".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Message {
                    message: "test broadcast".to_string(),
                },
            }),
        };

        state
            .ctl
            .lock()
            .await
            .channel_broadcast(sys_chan.clone(), ChannelMessage::Reply(message))
            .await
            .unwrap();

        for rx in [&mut rx1, &mut rx2] {
            if let Some(Ok(msg)) = rx.next().await {
                let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
                if resp[1] == "broadcast" {
                    assert_eq!(resp[4]["response"]["message"], "test broadcast");
                }
            }
        }
    }

    #[tokio::test]
    async fn test_ws_invalid_messages() {
        let (addr, _, _) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        tx.send(Message::text("invalid json")).await.unwrap();

        tx.send(Message::text(r#"["invalid","format"]"#))
            .await
            .unwrap();

        let invalid_channel = r#"["1","ref1","nonexistent","phx_join",{"token":"test"}]"#;
        tx.send(Message::text(invalid_channel)).await.unwrap();

        let heartbeat = r#"[null,"1","phoenix","heartbeat",{}]"#;
        tx.send(Message::text(heartbeat)).await.unwrap();

        if let Some(Ok(msg)) = rx.next().await {
            let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(resp[2], "phoenix");
            assert_eq!(resp[4]["status"], "ok");
        }
    }

    #[tokio::test]
    async fn test_ws_system_channel() {
        let (addr, state, sys_chan) = setup_test_server().await;
        let (mut tx, mut rx) = connect_client(&addr).await;

        let token = gen_token(&state, &sys_chan, "user1").await;
        let join_msg = format!(
            r#"["1","ref1","{}","phx_join",{{"token":"{}"}}]"#,
            sys_chan, token
        );
        tx.send(Message::text(join_msg)).await.unwrap();

        // Should receive initial join response
        if let Some(Ok(msg)) = rx.next().await {
            let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
            assert_eq!(resp[2], sys_chan);
            assert_eq!(resp[4]["status"], "ok");
        }

        // expect a datetime event within a few seconds
        match tokio::time::timeout(std::time::Duration::from_secs(5), rx.next()).await {
            Ok(Some(Ok(msg))) => {
                let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();
                if resp[2] == sys_chan && resp[3] == "datetime" {
                    assert!(resp[4]["response"]["datetime"].is_string());
                }
            }
            _ => panic!("Timed out waiting for datetime update"),
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
    fn test_ws_request_json_heartbeat() {
        let msg: RequestMessage =
            serde_json::from_str(r#"["1", "ref1", "room123", "heartbeat", {}]"#).unwrap();

        assert_eq!(msg.join_ref, Some("1".to_string()));
        assert_eq!(msg.event_ref, "ref1");
        assert_eq!(msg.topic, "room123");
        assert_eq!(msg.event, "heartbeat");
        assert_eq!(msg.payload, serde_json::from_value(json!({})).unwrap());
    }

    #[test]
    fn test_ws_request_json_join() {
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
    fn test_ws_request_json_message() {
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
    fn test_ws_request_json_message_payload() {
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
    fn test_ws_request_json_invalid() {
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

    async fn expect_msg_content(
        rx: &mut futures::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
        content: &str,
    ) {
        let timeout = std::time::Duration::from_secs(2);
        let start = std::time::Instant::now();

        loop {
            if start.elapsed() > timeout {
                panic!("Timeout waiting for message containing '{}'", content);
            }

            match tokio::time::timeout(std::time::Duration::from_millis(100), rx.next()).await {
                Ok(Some(Ok(msg))) => {
                    let s = msg.to_string();
                    if s.contains(content) {
                        return;
                    }
                }
                _ => continue,
            }
        }
    }

    // Verify that the Redis listener thread survives when all subscribers disconnect
    // and correctly relay messages when a new subscriber joins later.
    #[tokio::test]
    async fn test_redis_listener_survival_on_zero_subscribers() {
        let (addr, state, channel_name) = setup_test_server().await;

        let (mut tx_a, mut rx_a) = connect_client(&addr).await;
        let token_a = gen_token(&state, &channel_name, "user_a").await;
        tx_a.send(Message::text(format!(
            r#"["1","ref1","{}","phx_join",{{"token":"{}"}}]"#,
            channel_name, token_a
        )))
        .await
        .unwrap();

        // consume messages until join is confirmed (ignore presence noise)
        expect_msg_content(&mut rx_a, "phx_reply").await;

        // connect B, client A should get it
        let mut redis_conn = state
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();
        let redis_topic = format!("to:{}:test_event", channel_name);
        redis_conn
            .publish::<_, _, ()>(&redis_topic, r#"{"type":"message","message":"one"}"#)
            .await
            .unwrap();

        expect_msg_content(&mut rx_a, "one").await;

        // disconnect A -> 0 subscribers -> triggers potential suicide
        drop(tx_a);
        drop(rx_a);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        redis_conn
            .publish::<_, _, ()>(&redis_topic, r#"{"type":"message","message":"void"}"#)
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // connect B
        let (mut tx_b, mut rx_b) = connect_client(&addr).await;
        let token_b = gen_token(&state, &channel_name, "user_b").await;
        tx_b.send(Message::text(format!(
            r#"["2","ref2","{}","phx_join",{{"token":"{}"}}]"#,
            channel_name, token_b
        )))
        .await
        .unwrap();
        expect_msg_content(&mut rx_b, "phx_reply").await;

        redis_conn
            .publish::<_, _, ()>(&redis_topic, r#"{"type":"message","message":"two"}"#)
            .await
            .unwrap();
        expect_msg_content(&mut rx_b, "two").await;
    }

    // Verify that we can handle nested topics (e.g. weather:wind) and raw JSON payloads (no 'type' field)
    #[tokio::test]
    async fn test_nested_topics_and_raw_json() {
        let (addr, state, _) = setup_test_server().await;
        let nested_channel = "weather:wind";

        let (mut tx, mut rx) = connect_client(&addr).await;
        let token = gen_token(&state, nested_channel, "user_nested").await;

        tx.send(Message::text(format!(
            r#"["1","ref1","{}","phx_join",{{"token":"{}"}}]"#,
            nested_channel, token
        )))
        .await
        .unwrap();
        expect_msg_content(&mut rx, "phx_reply").await;

        let mut redis_conn = state
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();

        let raw_topic = "to:weather:wind:update";
        let raw_payload = r#"{"temperature": 25.5, "unit": "C"}"#;

        redis_conn
            .publish::<_, _, ()>(raw_topic, raw_payload)
            .await
            .unwrap();

        // find the specific update event, ignoring presence events
        let timeout = std::time::Duration::from_secs(2);
        let start = std::time::Instant::now();
        let mut found = false;

        while start.elapsed() < timeout {
            if let Ok(Some(Ok(msg))) =
                tokio::time::timeout(std::time::Duration::from_millis(100), rx.next()).await
            {
                let resp: serde_json::Value = serde_json::from_str(&msg.to_string()).unwrap();

                if resp.get(3).and_then(|v| v.as_str()) == Some("update") {
                    assert_eq!(resp[2], "weather:wind", "Topic parsed incorrectly");
                    assert_eq!(resp[4]["temperature"], 25.5, "Raw JSON payload corrupted");
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "Did not receive 'update' event with correct payload");
    }

    // Verify that channels are removed from memory after the last connection drops
    #[tokio::test]
    async fn test_ghost_channel_cleanup() {
        let (addr, state, _) = setup_test_server().await;
        let ghost_channel = format!("temp_{}", nanoid::nanoid!(4));

        let (mut tx, rx) = connect_client(&addr).await;
        let token = gen_token(&state, &ghost_channel, "ghost_user").await;
        tx.send(Message::text(format!(
            r#"["1","ref1","{}","phx_join",{{"token":"{}"}}]"#,
            ghost_channel, token
        )))
        .await
        .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            assert!(
                channels.contains_key(&ghost_channel),
                "Channel should exist"
            );
        }

        // abrupt disconnect
        drop(tx);
        drop(rx);

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        {
            let ctl = state.ctl.lock().await;
            let channels = ctl.channels.lock().await;
            assert!(
                !channels.contains_key(&ghost_channel),
                "Ghost channel leaked after disconnect"
            );
        }
    }
}

use futures::StreamExt;
use itertools::Itertools;
use redis::{AsyncCommands, RedisResult};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{hash_map::Entry, HashMap},
    error::Error,
    fmt::{self, Display},
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Arc,
    },
};
use tokio::{
    sync::{
        broadcast::{self, error::SendError},
        Mutex,
    },
    task::JoinHandle,
};
use tracing::{debug, error, info, warn};

use crate::websocket::{Response, ServerMessage, ServerPayload, State};

#[derive(Clone, Debug, Serialize)]
pub enum ChannelMessage {
    Reply(ServerMessage),
}

impl Display for ChannelMessage {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ChannelMessage::Reply(reply) => {
                write!(formatter, "<{}>", reply)
            }
        }
    }
}

/// agent channel, can broadcast to every agent in the channel
pub struct Channel {
    pub name: String,
    pub tx: broadcast::Sender<ChannelMessage>,
    pub agents: Mutex<Vec<String>>,
    pub count: AtomicU32,
    pub redis_listen_task: Option<JoinHandle<RedisResult<()>>>,
}

/// manages all channels
pub struct ChannelControl {
    pub channels: Mutex<HashMap<String, Channel>>, // channel name -> Channel
    redis_client: Arc<redis::Client>,
    pub agents: Mutex<HashMap<String, Agent>>,                           // agent_id -> JoinHandle
    agent_tx: Mutex<HashMap<String, broadcast::Sender<ChannelMessage>>>, // agent_id -> Sender, TODO: replace with `agents`
    conn_tx: Mutex<HashMap<String, broadcast::Sender<ChannelMessage>>>,  // conn_id -> Sender
}

#[derive(Debug)]
pub struct Agent {
    pub channel: String,
    pub id: String,
    pub external_id: String,
    relay_task: JoinHandle<()>,
}

impl Display for Agent {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "<Agent: id={} external_id={} channel={}, task={:?}>", self.id, self.external_id, self.channel, self.relay_task)
    }
}

#[derive(Debug, PartialEq)]
pub enum ChannelError {
    ChannelNotFound,
    ChannelEmpty,
    MessageSendError,
    AgentNotInitiated,
    BadToken,
}

impl Error for ChannelError {}

impl fmt::Display for ChannelError {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ChannelError::ChannelNotFound => write!(formatter, "<ChannelNotFound>"),
            ChannelError::ChannelEmpty => write!(formatter, "<ChannelEmpty: channel has not agents>"),
            ChannelError::AgentNotInitiated => write!(formatter, "<AgentNotInitiated>"),
            ChannelError::MessageSendError => write!(formatter, "<MessageSendError: failed to send a message to the channel>"),
            ChannelError::BadToken => write!(formatter, "<InvalidPayload: invalid payload format>"),
        }
    }
}

impl Channel {
    // capacity is the maximum number of messages that can be stored in the channel
    pub fn new(name: String, capacity: Option<usize>) -> Channel {
        let (tx, _rx) = broadcast::channel(capacity.unwrap_or(100));
        Channel {
            name,
            tx,
            agents: Mutex::new(vec![]),
            count: AtomicU32::new(0),
            redis_listen_task: None,
        }
    }

    /// agent joins the channel, returns a sender to the channel
    /// if agent does not exist, a new agent is added
    pub async fn join(&self, agent_id: String) -> broadcast::Sender<ChannelMessage> {
        let mut agents = self.agents.lock().await;
        if !agents.contains(&agent_id) {
            agents.push(agent_id.clone());
            self.count.fetch_add(1, Ordering::SeqCst);
            info!("C / {}, total: {:?}, agent added {}", self.name, self.count, agent_id);
        } else {
            info!("C / {}, total: {:?}, agent {} exists", self.name, self.count, agent_id);
        }
        self.tx.clone()
    }

    pub async fn leave(&self, agent_id: String) {
        let mut agents = self.agents.lock().await;
        if let Some(pos) = agents.iter().position(|x| *x == agent_id) {
            // - find index
            // - remove the item at index, use the last one to replace this position
            let agent = agents.swap_remove(pos);
            self.count.fetch_sub(1, Ordering::SeqCst);
            info!("C / {}, total: {:?}, agent removed {}", self.name, self.count, agent);
        }
    }

    /// broadcast messages to the channel
    /// it returns the number of agents who received the message
    pub fn send(&self, data: ChannelMessage) -> Result<usize, Box<SendError<ChannelMessage>>> {
        self.tx.send(data).map_err(Box::new)
    }

    pub fn empty(&self) -> bool {
        self.count.load(Ordering::SeqCst) == 0
    }

    pub async fn agents(&self) -> tokio::sync::MutexGuard<'_, Vec<String>> {
        self.agents.lock().await
    }
}

impl Default for ChannelControl {
    fn default() -> Self {
        let redis_client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        Self::new(Arc::new(redis_client))
    }
}

impl ChannelControl {
    pub fn new(redis_client: Arc<redis::Client>) -> Self {
        ChannelControl {
            channels: Mutex::new(HashMap::new()),
            redis_client,
            agent_tx: Mutex::new(HashMap::new()),
            agents: Mutex::new(HashMap::new()),
            conn_tx: Mutex::new(HashMap::new()),
        }
    }

    pub async fn conn_add_tx(&self, conn_id: String) {
        let mut conn_tx = self.conn_tx.lock().await;
        match conn_tx.entry(conn_id.clone()) {
            Entry::Vacant(entry) => {
                let (tx, _rx) = broadcast::channel(100);
                entry.insert(tx);
                debug!("CONN / conn_tx added, conn_id: {}", conn_id.clone());
            }
            Entry::Occupied(_) => {}
        }
    }

    pub async fn conn_rx(&self, conn_id: String) -> Result<broadcast::Receiver<ChannelMessage>, ChannelError> {
        Ok(self.conn_tx.lock().await.get(&conn_id).unwrap().subscribe())
    }

    pub async fn conn_tx(&self, conn_id: String) -> Result<broadcast::Sender<ChannelMessage>, ChannelError> {
        Ok(self.conn_tx.lock().await.get(&conn_id).unwrap().clone())
    }

    pub async fn conn_send(&self, conn_id: String, message: ChannelMessage) -> Result<usize, ChannelError> {
        self.conn_tx
            .lock()
            .await
            .get(&conn_id)
            .ok_or(ChannelError::ChannelNotFound)?
            .send(message)
            .map_err(|_| ChannelError::MessageSendError)
    }

    async fn conn_cleanup_presense_leave(&self, conn_id: String, channel_name: String) {
        let grouped_agents = self
            .agents
            .lock()
            .await
            .iter()
            .filter(|(_, agent)| agent.id.starts_with(&conn_id))
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
        info!("CONN_CLEANUP / grouped_agents {:?}", grouped_agents);
        if grouped_agents.is_empty() {
            info!("CONN_CLEANUP / no agents to leave");
            return;
        }

        let diff = json!({"joins": {}, "leaves": grouped_agents});

        let redis_conn_result = self.redis_client.clone().get_multiplexed_async_connection().await;
        if redis_conn_result.is_err() {
            error!("CONN_CLEANUP / fail to get redis connection");
            return;
        }
        let mut redis_conn = redis_conn_result.unwrap();
        let redis_topic = format!("to:{}:presence_diff", channel_name);
        let message = serde_json::to_string(&diff).unwrap();
        let publish_result: RedisResult<String> = redis_conn.publish(redis_topic.clone(), message.clone()).await;
        if let Err(e) = publish_result {
            error!("CONN_CLEANUP / fail to publish to redis: {}", e)
        } else {
            info!("CONN_CLEANUP / sent");
        }
    }

    // Clean up all resources related to conn: conn, channel, agent
    // agent_id: {conn_id}:{channel}:{join_ref}
    pub async fn conn_cleanup(&self, conn_id: String) {
        let mut agent_tx = self.agent_tx.lock().await;
        debug!("CONN / cleanup agent_tx, conn_id: {}, {} {:?}", conn_id, agent_tx.len(), agent_tx.keys().collect::<Vec<&String>>());
        agent_tx.retain(|k, _| !k.starts_with(&conn_id));
        debug!("CONN / agent_tx cleared, conn_id: {}, {} {:?}", conn_id, agent_tx.len(), agent_tx.keys().collect::<Vec<&String>>());

        self.conn_tx.lock().await.remove_entry(&conn_id);
        debug!("CONN / conn_tx cleared, {}", conn_id);

        for (name, channel) in self.channels.lock().await.iter() {
            self.conn_cleanup_presense_leave(conn_id.clone(), name.clone()).await;

            let mut agents = channel.agents.lock().await;
            debug!("CH / {}, agents {} {:?}", name, agents.len(), agents);
            agents.retain(|agent| !agent.starts_with(&conn_id));
            // channel may be empty, need to clear inside
            debug!("CH / {}, removed agents of conn {}, agents {} {:?}", name, conn_id, agents.len(), agents);

            let meta = json!({"agent": serde_json::Value::Null, "channel": name, "agents": *agents});
            self.pub_meta_event("channel".into(), "leave".into(), meta).await;
        }

        self.agents.lock().await.retain(|k, agent| {
            if k.starts_with(&conn_id) {
                agent.relay_task.abort();
                info!("CONN / {} relay task aborts.", agent.id);
            }
            info!("CONN / {} to be removed", agent.id);
            !k.starts_with(&conn_id)
        });
    }

    pub async fn channel_add(&self, channel_name: String, capacity: Option<usize>) {
        let mut channels = self.channels.lock().await;
        channels
            .entry(channel_name.clone())
            .or_insert_with(|| Channel::new(channel_name.clone(), capacity));
        // None if key does not exist, or value replace and old value retured
        // let inserted = channels.insert(channel_name.clone(), Channel::new(channel_name.clone(), capacity));
        debug!("CH / channel {} added", channel_name);
    }

    pub async fn channel_add_redis_listen_task(&self, channel_name: String, redis_listen_task: JoinHandle<RedisResult<()>>) {
        let mut channels = self.channels.lock().await;
        let channel = channels.get_mut(&channel_name).unwrap();
        channel.redis_listen_task = Some(redis_listen_task);
        info!("CH / added redis listen task to channel {}", channel_name);

        let meta = json!({"channel": channel_name});
        self.pub_meta_event("channel".into(), "add-redis-listener".into(), meta).await;
    }

    pub async fn pub_meta_event(&self, topic: String, event: String, meta: serde_json::Value) {
        let redis_topic = format!("to:admin:{}.{}", topic, event);

        let redis_conn_result = self.redis_client.clone().get_multiplexed_async_connection().await;
        if redis_conn_result.is_err() {
            error!("ADMIN_PUB / fail to get redis connection");
            return;
        }

        let message = serde_json::to_string(&meta).unwrap();
        let result: RedisResult<String> = redis_conn_result.unwrap().publish(redis_topic, message.clone()).await;
        if result.is_err() {
            error!("ADMIN_PUB / fail to publish to redis");
            return;
        }

        info!("ADMIN_PUB / event published to redis");
    }

    // Delete a channel
    // All resources on the channel: channel, agents, agent_tx, relay_task, redis_listen_task, conn_tx
    pub async fn channel_rm(&self, channel_name: String) {
        let mut channels = self.channels.lock().await;
        match channels.entry(channel_name.clone()) {
            Entry::Vacant(_) => {}
            Entry::Occupied(entry) => {
                let channel = entry.get();
                for agent_id in channel.agents().await.iter() {
                    if let Entry::Occupied(agent_task) = self.agents.lock().await.entry(agent_id.into()) {
                        agent_task.get().relay_task.abort();
                        info!("CH_RM / channel {}, agent {}, relay_task aborted", channel_name, agent_id);
                        agent_task.remove();
                    }
                }
                if let Some(task) = &channel.redis_listen_task {
                    task.abort();
                    info!("CH_RM / channel {} redis listen task aborted", channel_name);
                }

                entry.remove();
                info!("CH_RM / removed from channels, {}", channel_name);
            }
        }
        let channel_names = channels.keys().cloned().collect::<Vec<String>>();

        let meta = json!({"channel": channel_name, "channels": channel_names});
        self.pub_meta_event("channel".into(), "remove".into(), meta).await;

        info!("CH_RM / {} cleared, channels: {} {:?}", channel_name, channel_names.len(), channel_names);
    }

    pub async fn channel_exists(&self, channel_name: &str) -> bool {
        let channels = self.channels.lock().await;
        channels.contains_key(channel_name)
    }
    /// join agent to a channel
    pub async fn channel_join(
        &self, channel_name: &str, agent_id: String, external_id: String,
    ) -> Result<broadcast::Sender<ChannelMessage>, ChannelError> {
        let channels = self.channels.lock().await;

        // join
        let channel = channels.get(channel_name).ok_or(ChannelError::ChannelNotFound)?;
        let channel_tx = channel.join(agent_id.clone()).await;
        let mut channel_rx = channel_tx.subscribe();
        let agent_tx = self.agent_tx.lock().await.get(&agent_id).ok_or(ChannelError::AgentNotInitiated)?.clone();

        // Subscribe to channel and forward messages to agent
        let relay_task = tokio::spawn(async move {
            while let Ok(channel_message) = channel_rx.recv().await {
                match &channel_message {
                    ChannelMessage::Reply(_reply_message) => {
                        let _ = agent_tx.send(channel_message);
                    }
                }
            }
        });

        match self.agents.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(_) => {
                warn!("AGENT / {} already has a relay task", agent_id);
            }
            Entry::Vacant(entry) => {
                entry.insert(Agent {
                    id: agent_id.clone(),
                    external_id: external_id.clone(),
                    channel: channel_name.to_string().clone(),
                    relay_task,
                });
            }
        }

        let meta = json!({"agent": agent_id.clone(), "channel": channel_name, "agents": *channel.agents.lock().await});
        self.pub_meta_event("channel".into(), "join".into(), meta).await;

        Ok(channel_tx)
    }

    pub async fn channel_leave(&self, channel_name: String, agent_id: String) -> Result<usize, ChannelError> {
        info!("CH / leave {} from {} ...", agent_id, channel_name);
        let channels = self.channels.lock().await;
        let channel = channels.get(&channel_name).ok_or(ChannelError::ChannelNotFound)?;
        channel.leave(agent_id.clone()).await;
        match self.agents.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.get().relay_task.abort();
                entry.remove();
                debug!("AGENT / {} relay task removed", agent_id);
            }
            Entry::Vacant(_) => {}
        }

        let meta = json!({"agent": agent_id.clone(), "channel": channel_name.clone(), "agents": *channel.agents.lock().await});
        self.pub_meta_event("channel".into(), "leave".into(), meta).await;

        Ok(channel.count.load(Ordering::SeqCst) as usize)
    }

    pub async fn channel_broadcast_json(&self, channel_name: &str, event_name: &str, value: serde_json::Value) -> Result<usize, ChannelError> {
        let message = ServerMessage {
            join_ref: None,
            event_ref: "0".into(),
            topic: channel_name.to_string(),
            event: event_name.to_string(),
            payload: ServerPayload::ServerJsonValue(value),
        };
        self.channel_broadcast(channel_name.to_string(), ChannelMessage::Reply(message)).await
    }

    /// broadcast message to the channel
    /// it returns the number of agents who received the message
    pub async fn channel_broadcast(&self, channel_name: String, message: ChannelMessage) -> Result<usize, ChannelError> {
        let channels = self.channels.lock().await;
        let channel = channels.get(&channel_name).ok_or(ChannelError::ChannelNotFound)?;
        if channel.agents.lock().await.is_empty() {
            // warn!("CH / no agents, no broadcasting");
            return Err(ChannelError::ChannelEmpty);
        }

        channel.send(message).map_err(|e| {
            error!("CH / broadcasting error, channel: {}, {:?}", channel_name, e);
            ChannelError::MessageSendError
        })
    }

    pub async fn agent_rx(&self, agent_id: String) -> Result<broadcast::Receiver<ChannelMessage>, ChannelError> {
        Ok(self
            .agent_tx
            .lock()
            .await
            .get(&agent_id)
            .ok_or(ChannelError::AgentNotInitiated)?
            .subscribe())
    }

    /// Add channel agent to the channel ctl, just add agent tx
    /// `capacity` is the maximum number of messages that can be stored in the channel. The default value is 100.
    /// This will create a broadcast channel: ChannelAgent will write to and websocket_tx_task will subscribe to and read from
    pub async fn agent_add(&self, agent_id: String, capacity: Option<usize>) {
        match self.agent_tx.lock().await.entry(agent_id.clone()) {
            Entry::Vacant(entry) => {
                let (tx, _rx) = broadcast::channel(capacity.unwrap_or(100));
                entry.insert(tx);
                info!("AGENT / added: {}", agent_id.clone());
            }
            Entry::Occupied(_) => {
                info!("AGENT / already exists: {}", agent_id.clone());
            }
        }

        let agents = self.agent_list().await;
        info!("AGENT / list: {} {:?}", agents.len(), agents);
    }

    /// remove the agent after leaving all channels, returns external_id
    pub async fn agent_rm(&self, agent_id: String) -> Option<String> {
        let mut external_id: Option<String> = None;

        match self.agents.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.get().relay_task.abort();
                external_id = Some(entry.get().external_id.clone());
                entry.remove();
                debug!("AGENT / {} relay task removed", agent_id);
            }
            Entry::Vacant(_) => {}
        }

        match self.agent_tx.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.remove();
                debug!("AGENT / {} tx removed", agent_id);
            }
            Entry::Vacant(_) => {}
        }
        // Also need to remove from Channel agents
        for channel in self.channels.lock().await.values() {
            channel.leave(agent_id.clone()).await;
        }

        let agents = self.agent_list().await;
        info!("AGENT / list {} {:?}", agents.len(), agents);

        external_id
    }

    /// list all agents
    pub async fn agent_list(&self) -> Vec<String> {
        self.agent_tx.lock().await.keys().cloned().collect()
    }
}

/// Deserialized from Redis, then forwarded to websocket
/// Serialization needs to be consistent with Response
/// Will add a type field, which can be null, join, Heartbeat, datetime, message
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ResponseFromRedis {
    #[serde(rename = "null")]
    Empty {},

    #[serde(rename = "join")]
    Join { id: String },

    #[serde(rename = "heartbeat")]
    Heartbeat {},

    #[serde(rename = "datetime")]
    Datetime { datetime: String, counter: u32 },

    #[serde(rename = "message")]
    Message { message: String },
}

impl From<ResponseFromRedis> for Response {
    fn from(val: ResponseFromRedis) -> Self {
        match val {
            ResponseFromRedis::Empty {} => Response::Empty {},
            ResponseFromRedis::Join { id } => Response::Join { id },
            ResponseFromRedis::Heartbeat {} => Response::Heartbeat {},
            ResponseFromRedis::Datetime { datetime, counter } => Response::Datetime { datetime, counter },
            ResponseFromRedis::Message { message } => Response::Message { message },
        }
    }
}

#[derive(Debug)]
struct ChannelEventFromRedis {
    channel: String,
    event: String,
}

impl ChannelEventFromRedis {
    /// parse the format to:channel_name:event_name
    fn parse(redis_channel: &str) -> Result<Self, &'static str> {
        if !redis_channel.starts_with("to:") {
            return Err("invalid channel format");
        }
        let content = &redis_channel[3..];
        match content.rfind(':') {
            Some(idx) => Ok(Self {
                channel: content[..idx].to_string(),
                event: content[idx + 1..].to_string(),
            }),
            None => Err("invalid channel format"),
        }
    }
}

/// Listen to messages from redis, per channel task
pub async fn listen_to_redis(
    state: Arc<State>, tx: broadcast::Sender<ChannelMessage>, redis_client: redis::Client, channel_name: String,
) -> RedisResult<()> {
    let redis_topic = format!("to:{}:*", channel_name);
    let mut redis_pubsub = redis_client.get_async_pubsub().await?;
    redis_pubsub.psubscribe(redis_topic.clone()).await?;
    let mut redis_pubsub_stream = redis_pubsub.on_message();
    let counter = Arc::new(AtomicU64::new(0));

    info!("LISTENER / subscribed to redis, channel: {}", redis_topic);

    loop {
        let Some(stream_message) = redis_pubsub_stream.next().await else {
            error!("LISTENER / stream ended");
            break;
        };

        let ev = match ChannelEventFromRedis::parse(stream_message.get_channel_name()) {
            Ok(ev) => ev,
            Err(err) => {
                warn!("LISTENER / parse error: {} ({})", err, stream_message.get_channel_name());
                continue;
            }
        };

        let payload: String = match stream_message.get_payload() {
            Ok(p) => p,
            Err(e) => {
                error!("LISTENER / payload error: {}", e);
                continue;
            }
        };

        // NOTE: Accept any JSON payload, don't enforce internal strict types
        let value = match serde_json::from_str::<serde_json::Value>(&payload) {
            Ok(v) => v,
            Err(e) => {
                warn!("LISTENER / json error: {} in {}", e, payload);
                continue;
            }
        };

        let reply_message = ServerMessage {
            join_ref: None,
            event_ref: counter.fetch_add(1, Ordering::Relaxed).to_string(),
            topic: ev.channel,
            event: ev.event,
            payload: ServerPayload::ServerJsonValue(value),
        };

        // Do not suicide if sending fails (no active subscribers)
        if let Err(_) = tx.send(ChannelMessage::Reply(reply_message)) {
            debug!("LISTENER / no subscribers for {}", channel_name);
        }
    }

    let ctl = state.ctl.lock().await;
    let mut channels = ctl.channels.lock().await;
    if let Some(channel) = channels.get_mut(&channel_name) {
        channel.redis_listen_task = None;
    }

    Ok(())
}

// async fn _channel_publish(counter: i32, value: serde_json::Value, tx: broadcast::Sender<ChannelMessage>, channel_name: &str, event_name: &str) {
//     let reply_message = ServerMessage {
//         join_ref: None,
//         event_ref: counter.to_string(),
//         topic: channel_name.to_string(),
//         event: event_name.to_string(),
//         payload: ServerPayload::ServerJsonValue(value),
//     };
//     match tx.send(ChannelMessage::Reply(reply_message.clone())) {
//         Ok(_) => debug!("REDIS_PUB / published, {} > {}", event_name, reply_message),
//         Err(e) => error!("REDIS_PUB / fail to send, channel: {}, event: {}, err: {}", channel_name, event_name, e),
//     }
// }

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use tokio::sync::broadcast;

    use crate::channel::{Channel, ChannelControl, ChannelError, ChannelMessage};
    use crate::utils::random_string;
    use crate::websocket::{Response, ServerMessage, ServerPayload, ServerResponse};

    fn create_test_message(topic: &str, reference: &str, message: &str) -> ChannelMessage {
        ChannelMessage::Reply(ServerMessage {
            join_ref: None,
            event_ref: reference.to_string(),
            topic: topic.to_string(),
            event: "test_event".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Message {
                    message: message.to_string(),
                },
            }),
        })
    }

    #[tokio::test]
    async fn test_broadcast_capacity() {
        let capacity = 2;
        let (tx, mut rx1) = broadcast::channel::<&str>(capacity);
        let mut rx2 = tx.subscribe();

        // Send more messages than capacity
        tx.send("msg1").unwrap();
        tx.send("msg2").unwrap();
        tx.send("msg3").unwrap();

        // Check rx1 - should miss first message
        match rx1.try_recv() {
            Err(broadcast::error::TryRecvError::Lagged(skipped)) => {
                assert_eq!(skipped, 1);
                assert_eq!(rx1.try_recv().unwrap(), "msg2");
            }
            Ok(msg) => panic!("Expected Lagged error, got message: {}", msg),
            Err(e) => panic!("Unexpected error: {:?}", e),
        }

        // Check rx2 - should also miss first message
        match rx2.try_recv() {
            Err(broadcast::error::TryRecvError::Lagged(skipped)) => {
                assert_eq!(skipped, 1);
                assert_eq!(rx2.try_recv().unwrap(), "msg2");
            }
            Ok(msg) => panic!("Expected Lagged error, got message: {}", msg),
            Err(e) => panic!("Unexpected error: {:?}", e),
        }

        // Next message should be msg3
        assert_eq!(rx1.try_recv().unwrap(), "msg3");
        assert_eq!(rx2.try_recv().unwrap(), "msg3");

        // No more messages
        assert!(rx1.try_recv().is_err());
        assert!(rx2.try_recv().is_err());
    }

    #[tokio::test]
    async fn test_channel_capacity() {
        let channel = Channel::new("test".to_string(), Some(2));
        let agent_id = "agent1".to_string();
        let tx = channel.join(agent_id.clone()).await;
        let mut rx = tx.subscribe();

        // Send messages (exceeding capacity)
        for i in 0..3 {
            let msg = create_test_message("test", &i.to_string(), &format!("msg{}", i));
            assert_eq!(channel.send(msg).unwrap(), 1);
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // handle potential lag for the first read
        match rx.try_recv() {
            Err(broadcast::error::TryRecvError::Lagged(_)) => {
                // expected lag, consume next
            }
            Ok(msg) => panic!("Expected Lagged error, got message: {:?}", msg),
            Err(e) => panic!("Unexpected error: {:?}", e),
        }

        let mut messages = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            let ChannelMessage::Reply(reply) = msg;
            if let ServerPayload::ServerResponse(server_response) = reply.payload {
                if let Response::Message { message } = server_response.response {
                    messages.push(message);
                }
            }
        }

        // with lagged receiver, we should only get the last 2 messages due to capacity limit
        assert_eq!(messages.len(), 2);
        assert!(messages.contains(&"msg1".to_string()));
        assert!(messages.contains(&"msg2".to_string()));
    }

    // Fix test_channel_control_operations with manual setup and steps
    #[tokio::test]
    async fn test_channel_control_operations() {
        let redis_client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let ctl = ChannelControl::new(Arc::new(redis_client));

        // Add channels
        ctl.channel_add("room1".into(), None).await;
        ctl.channel_add("room2".into(), None).await;

        // Add agents
        ctl.agent_add("user1".into(), None).await;
        ctl.agent_add("user2".into(), None).await;

        // Join channels
        let join1 = ctl.channel_join("room1", "user1".into(), random_string(8)).await;
        assert!(join1.is_ok());
        let join2 = ctl.channel_join("room2", "user1".into(), random_string(8)).await;
        assert!(join2.is_ok());
        let join3 = ctl.channel_join("room1", "user2".into(), random_string(8)).await;
        assert!(join3.is_ok());

        // Broadcast message to room1
        let msg = create_test_message("room1", "1", "hello room1");
        let result = ctl.channel_broadcast("room1".into(), msg).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 2); // Both users should receive

        // Leave room1
        let leave = ctl.channel_leave("room1".into(), "user1".into()).await;
        assert!(leave.is_ok());

        // Broadcast again - only user2 should receive
        let msg = create_test_message("room1", "2", "hello again");
        let result = ctl.channel_broadcast("room1".into(), msg).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);
    }

    // Fix test_connection_close with explicit cleanup
    #[tokio::test]
    async fn test_connection_close() {
        let redis_client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let ctl = ChannelControl::new(Arc::new(redis_client));

        // Setup the connection and channel
        let conn_id = "test_conn_id";
        let agent_id = format!("{}:system:1", conn_id);

        ctl.channel_add("system".into(), None).await;
        ctl.conn_add_tx(conn_id.to_string()).await;
        ctl.agent_add(agent_id.clone(), None).await;

        // Join the channel
        let join = ctl.channel_join("system", agent_id.clone(), random_string(8)).await;
        assert!(join.is_ok());

        // Verify agent is in channel
        {
            let channels = ctl.channels.lock().await;
            let channel = channels.get("system").unwrap();
            let agents = channel.agents.lock().await;
            assert!(agents.contains(&agent_id));
        }

        // Simulate connection close
        ctl.conn_cleanup(conn_id.to_string()).await;

        // Verify agent is removed from channel
        {
            let channels = ctl.channels.lock().await;
            let channel = channels.get("system").unwrap();
            let agents = channel.agents.lock().await;
            assert!(!agents.contains(&agent_id));
        }
    }

    // FIXEME: test is flaky
    //
    // #[tokio::test]
    // async fn test_broadcast_capacity() {
    //     let capacity = 2;
    //     let (tx, mut rx1) = broadcast::channel::<&str>(capacity);
    //     let mut rx2 = tx.subscribe();
    //
    //     tx.send("msg1").unwrap();
    //     tx.send("msg2").unwrap();
    //     tx.send("msg3").unwrap(); // the first message is discarded when the third message is sent, as it was never read
    //     tokio::time::sleep(tokio::time::Duration::from_millis(3000)).await;
    //
    //     let mut r1_messages = Vec::new();
    //     while let Ok(msg) = rx1.try_recv() {
    //         r1_messages.push(msg);
    //     }
    //
    //     let mut r2_messages = Vec::new();
    //     while let Ok(msg) = rx2.try_recv() {
    //         r2_messages.push(msg);
    //     }
    //
    //     // FIXME: it's asserted, but it's not guaranteed that the message is lost
    //     assert!(
    //         !r1_messages.contains(&"msg1") || !r2_messages.contains(&"msg1"),
    //         "`msg1` is lost in one of them"
    //     );
    // }

    // FIXME: test is flaky
    //
    // #[tokio::test]
    // async fn test_channel_capacity() {
    //     let channel = Channel::new("test".to_string(), Some(2));
    //     let agent_id = "agent1".to_string();
    //     let tx = channel.join(agent_id.clone()).await;
    //     let mut rx = tx.subscribe();
    //
    //     // Send messages with delay between each
    //     for i in 0..3 {
    //         let msg = create_test_message("test", &i.to_string(), &format!("msg{}", i));
    //         assert_eq!(channel.send(msg).unwrap(), 1);
    //         tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    //     }
    //
    //     // Give time for messages to propagate
    //     tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    //
    //     // Collect available messages
    //     let mut messages = Vec::new();
    //     while let Ok(msg) = rx.try_recv() {
    //         if let ChannelMessage::Reply(reply) = msg {
    //             if let Response::Message { message } = reply.payload.response {
    //                 messages.push(message);
    //             }
    //         }
    //     }
    //
    //     // With lagged receiver, we should only get the last 2 messages due to capacity limit
    //     assert_eq!(messages.len(), 2);
    //     assert!(messages.contains(&"msg1".to_string()));
    //     assert!(messages.contains(&"msg2".to_string()));
    // }

    #[tokio::test]
    async fn test_channel_creation_and_basic_ops() {
        let channel = Channel::new("test".to_string(), None);
        assert_eq!(channel.name, "test");
        assert!(channel.empty());

        // Test joining
        let agent_id = "agent1".to_string();
        let _tx = channel.join(agent_id.clone()).await;
        assert!(!channel.empty());

        // Test agent count
        assert_eq!(channel.agents().await.len(), 1);

        // Test duplicate join
        let _tx2 = channel.join(agent_id.clone()).await;
        assert_eq!(channel.agents().await.len(), 1); // Should not increase

        // Test leave
        channel.leave(agent_id).await;
        assert!(channel.empty());
    }

    #[tokio::test]
    async fn test_channel_message_broadcast() {
        let channel = Channel::new("test".to_string(), Some(10));
        let agent_id = "agent1".to_string();

        // Join and get sender
        let tx = channel.join(agent_id.clone()).await;
        let mut rx = tx.subscribe();

        // Test message sending
        let test_msg = create_test_message("test", "1", "hello");
        let recv_count = channel.send(test_msg.clone()).unwrap();
        assert_eq!(recv_count, 1);

        // Verify received message
        if let Ok(ChannelMessage::Reply(msg)) = rx.try_recv() {
            assert_eq!(msg.topic, "test");

            if let ServerPayload::ServerResponse(server_response) = msg.payload {
                if let Response::Message { message } = server_response.response {
                    assert_eq!(message, "hello");
                } else {
                    panic!("Wrong response type");
                }
            } else {
                panic!("Wrong payload type");
            }
        } else {
            panic!("Failed to receive message");
        }
    }

    // FIXEME: test is flaky
    //
    // #[tokio::test]
    // async fn test_channel_control_operations() {
    //     let ctl = ChannelControl::new();
    //
    //     // Test channel management
    //     ctl.new_channel("room1".into(), None).await;
    //     ctl.new_channel("room2".into(), None).await;
    //
    //     // Test agent operations
    //     ctl.add_agent("user1".into(), None).await;
    //     ctl.add_agent("user2".into(), None).await;
    //
    //     // Test joining
    //     assert!(ctl.join_channel("room1", "user1".into()).await.is_ok());
    //     assert!(ctl.join_channel("room2", "user1".into()).await.is_ok());
    //     assert!(ctl.join_channel("room1", "user2".into()).await.is_ok());
    //
    //     // Test broadcasting
    //     let msg = create_test_message("room1", "1", "hello room1");
    //     let recv_count = ctl.broadcast("room1".into(), msg).await.unwrap();
    //     assert_eq!(recv_count, 2); // Both users should receive
    //
    //     // Test leaving
    //     assert!(ctl
    //         .leave_channel("room1".into(), "user1".into())
    //         .await
    //         .is_ok());
    //     let msg = create_test_message("room1", "2", "hello again");
    //     let recv_count = ctl.broadcast("room1".into(), msg).await.unwrap();
    //     assert_eq!(recv_count, 1); // Only user2 should receive
    // }

    #[tokio::test]
    async fn test_channel_error_cases() {
        let ctl = ChannelControl::default();

        // Test non-existent channel
        let result = ctl.channel_join("nonexistent", "user1".into(), random_string(8)).await;
        assert!(matches!(result.unwrap_err(), ChannelError::ChannelNotFound));

        // Test non-initiated agent
        ctl.channel_add("room1".into(), None).await;
        let result = ctl.channel_join("room1", "user1".into(), random_string(8)).await;
        assert!(matches!(result.unwrap_err(), ChannelError::AgentNotInitiated));

        // Test leave non-existent channel
        let result = ctl.channel_leave("nonexistent".into(), "user1".into()).await;
        assert!(matches!(result.unwrap_err(), ChannelError::ChannelNotFound));
    }

    #[tokio::test]
    async fn test_agent_subscription() {
        let ctl = ChannelControl::default();

        // Setup channels and agent
        ctl.channel_add("room1".into(), None).await;
        ctl.agent_add("user1".into(), None).await;

        // Test subscription before join
        let sub = ctl.agent_rx("user1".into()).await;
        assert!(sub.is_ok());

        // Join channel and test broadcasting
        ctl.channel_join("room1", "user1".into(), random_string(8)).await.unwrap();
        let msg = create_test_message("room1", "1", "test");
        let count = ctl.channel_broadcast("room1".into(), msg).await.unwrap();
        assert_eq!(count, 1);

        // Test subscription after removal
        ctl.agent_rm("user1".into()).await;
        let sub = ctl.agent_rx("user1".into()).await;
        assert!(matches!(sub.unwrap_err(), ChannelError::AgentNotInitiated));
    }

    #[tokio::test]
    async fn test_ctl_add_remove() {
        let ctl = ChannelControl::default();
        assert_eq!(ctl.channels.lock().await.len(), 0);

        ctl.channel_add("test".into(), None).await;
        assert_eq!(ctl.channels.lock().await.len(), 1);

        ctl.channel_rm("test".into()).await;
        assert_eq!(ctl.channels.lock().await.len(), 0);
    }

    #[tokio::test]
    async fn test_join_leave() {
        let ctl = ChannelControl::default();

        ctl.channel_add("test".into(), None).await; // new channel

        // new agent
        let agent_id = "agent1".to_string();
        ctl.agent_add(agent_id.clone(), None).await;

        // join channel
        let result = ctl.channel_join("test", agent_id.clone(), random_string(8)).await;
        assert!(result.is_ok(), "Should successfully join channel");

        // leave channel
        let result = ctl.channel_leave("test".to_string(), agent_id.clone()).await;
        assert!(result.is_ok(), "Should successfully leave channel");
    }

    #[tokio::test]
    async fn test_channel_basics() {
        let ctl = ChannelControl::default();

        // new channel
        ctl.channel_add("test".into(), None).await;

        // new agent
        let agent_id = "agent1".to_string();
        ctl.agent_add(agent_id.clone(), None).await;

        // join channel
        let result = ctl.channel_join("test", agent_id.clone(), random_string(8)).await;
        assert!(result.is_ok(), "Should successfully join channel");

        // broadcast message
        let message = ChannelMessage::Reply(ServerMessage {
            join_ref: None,
            event_ref: "1".to_string(),
            topic: "test".to_string(),
            event: "test_event".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Message {
                    message: "test message".to_string(),
                },
            }),
        });

        let result = ctl.channel_broadcast("test".to_string(), message).await;
        assert!(result.is_ok(), "Should successfully broadcast message");
        assert_eq!(result.unwrap(), 1, "Should have 1 receiver");

        // leave channel
        let result = ctl.channel_leave("test".to_string(), agent_id.clone()).await;
        assert!(result.is_ok(), "Should successfully leave channel");
    }

    #[tokio::test]
    async fn test_multiple_agents() {
        let ctl = ChannelControl::default();
        ctl.channel_add("room1".into(), None).await;

        // Add multiple agents
        let agent_ids = vec!["agent1", "agent2", "agent3"];
        for agent_id in &agent_ids {
            ctl.agent_add(agent_id.to_string(), None).await;
            let result = ctl.channel_join("room1", agent_id.to_string(), random_string(8)).await;
            assert!(result.is_ok(), "Agent should join successfully");
        }

        // Broadcast a message
        let message = ChannelMessage::Reply(ServerMessage {
            join_ref: None,
            event_ref: "1".to_string(),
            topic: "room1".to_string(),
            event: "broadcast".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Message {
                    message: "hello all".to_string(),
                },
            }),
        });

        let result = ctl.channel_broadcast("room1".to_string(), message).await;
        assert!(result.is_ok(), "Should successfully broadcast");
        assert_eq!(result.unwrap(), 3, "Should have 3 receivers");
    }

    // ctl can be cloned?
    // Test concurrent channel operations
    // #[tokio::test]
    // async fn test_concurrent_channel_ops() {
    //     let ctl = ChannelControl::new();
    //     ctl.new_channel("room1".into(), None).await;
    //
    //     let mut join_handles = vec![];
    //
    //     // Spawn multiple tasks to join/leave channel
    //     for i in 0..10 {
    //         let ctl = ctl.clone();
    //         let handle = tokio::spawn(async move {
    //             let agent_id = format!("agent{}", i);
    //             ctl.add_agent(agent_id.clone(), None).await;
    //
    //             // Join channel
    //             let _ = ctl.join_channel("room1", agent_id.clone()).await;
    //             sleep(Duration::from_millis(10)).await;
    //
    //             // Leave channel
    //             let _ = ctl.leave_channel("room1".into(), agent_id).await;
    //         });
    //         join_handles.push(handle);
    //     }
    //
    //     // Wait for all tasks to complete
    //     for handle in join_handles {
    //         handle.await.unwrap();
    //     }
    //
    //     // Verify final state
    //     let channel = ctl.channel_map.lock().await.get("room1").unwrap().clone();
    //     assert!(
    //         channel.empty(),
    //         "Channel should be empty after all agents leave"
    //     );
    // }

    // Test message ordering
    #[tokio::test]
    async fn test_message_ordering() {
        let ctl = ChannelControl::default();
        ctl.channel_add("room1".into(), None).await;
        ctl.agent_add("agent1".into(), None).await;

        let _ = ctl.channel_join("room1", "agent1".into(), random_string(8)).await.unwrap();

        let mut rx = ctl.agent_rx("agent1".into()).await.unwrap();

        // Send multiple messages
        for i in 0..5 {
            let msg = create_test_message("room1", &i.to_string(), &format!("msg{}", i));
            ctl.channel_broadcast("room1".into(), msg).await.unwrap();
        }

        // Verify messages are received in order
        for i in 0..5 {
            if let Ok(ChannelMessage::Reply(reply)) = rx.recv().await {
                assert_eq!(reply.event_ref, i.to_string());
            }
        }
    }

    // Test error handling
    #[tokio::test]
    async fn test_error_handling() {
        let ctl = ChannelControl::default();

        // Test joining non-existent channel
        let result = ctl.channel_join("nonexistent", "agent1".into(), random_string(8)).await;
        assert!(result.is_err());

        // Test leaving non-existent channel
        let result = ctl.channel_leave("nonexistent".into(), "agent1".into()).await;
        assert!(result.is_err());

        // Test broadcasting to non-existent channel
        let msg = create_test_message("nonexistent", "1", "test");
        let result = ctl.channel_broadcast("nonexistent".into(), msg).await;
        assert!(result.is_err());
    }

    // Test resource cleanup
    #[tokio::test]
    async fn test_resource_cleanup() {
        let ctl = ChannelControl::default();
        ctl.channel_add("room1".into(), None).await;

        // Add multiple agents and join channel
        for i in 0..5 {
            let agent_id = format!("agent{}", i);
            ctl.agent_add(agent_id.clone(), None).await;
            let _ = ctl.channel_join("room1", agent_id.clone(), random_string(8)).await;
        }

        // Remove channel
        ctl.channel_rm("room1".into()).await;

        // Verify cleanup
        assert!(ctl.channels.lock().await.is_empty());

        // Attempt to send message to removed channel
        let msg = create_test_message("room1", "1", "test");
        let result = ctl.channel_broadcast("room1".into(), msg).await;
        assert!(result.is_err());
    }

    // ctl can be cloned?
    // Test simultaneous broadcasting
    // #[tokio::test]
    // async fn test_concurrent_broadcasting() {
    //     let ctl = ChannelControl::new();
    //     ctl.new_channel("room1".into(), None).await;
    //
    //     // Add multiple agents
    //     for i in 0..3 {
    //         let agent_id = format!("agent{}", i);
    //         ctl.add_agent(agent_id.clone(), None).await;
    //         let _ = ctl.join_channel("room1", agent_id).await;
    //     }
    //
    //     let mut handles = vec![];
    //
    //     // Spawn multiple tasks to broadcast messages
    //     for i in 0..5 {
    //         let ctl = ctl.clone();
    //         let handle = tokio::spawn(async move {
    //             let msg = create_test_message("room1", &i.to_string(), &format!("msg{}", i));
    //             ctl.broadcast("room1".into(), msg).await.unwrap();
    //         });
    //         handles.push(handle);
    //     }
    //
    //     // Wait for all broadcasts to complete
    //     for handle in handles {
    //         handle.await.unwrap();
    //     }
    // }

    // #[tokio::test]
    // async fn test_message_ordering() {
    //     let ctl = ChannelControl::new();
    //     ctl.channel_add("room1".into(), None).await;
    //     ctl.agent_add("agent1".into(), None).await;
    //
    //     let _ = ctl.channel_join("room1", "agent1".into()).await.unwrap();
    //
    //     let mut rx = ctl.agent_rx("agent1".into()).await.unwrap();
    //
    //     // Send multiple messages
    //     for i in 0..5 {
    //         let msg = create_test_message("room1", &i.to_string(), &format!("msg{}", i));
    //         ctl.channel_broadcast("room1".into(), msg).await.unwrap();
    //     }
    //
    //     // Verify messages are received in order
    //     for i in 0..5 {
    //         if let Ok(ChannelMessage::Reply(reply)) = rx.recv().await {
    //             assert_eq!(reply.event_ref, i.to_string());
    //         }
    //     }
    // }

    // Test error handling
    // #[tokio::test]
    // async fn test_error_handling() {
    //     let ctl = ChannelControl::new();
    //
    //     // Test joining non-existent channel
    //     let result = ctl.channel_join("nonexistent", "agent1".into()).await;
    //     assert!(result.is_err());
    //
    //     // Test leaving non-existent channel
    //     let result = ctl.channel_leave("nonexistent".into(), "agent1".into()).await;
    //     assert!(result.is_err());
    //
    //     // Test broadcasting to non-existent channel
    //     let msg = create_test_message("nonexistent", "1", "test");
    //     let result = ctl.channel_broadcast("nonexistent".into(), msg).await;
    //     assert!(result.is_err());
    // }

    // Test resource cleanup
    // #[tokio::test]
    // async fn test_resource_cleanup() {
    //     let ctl = ChannelControl::new();
    //     ctl.channel_add("room1".into(), None).await;
    //
    //     // Add multiple agents and join channel
    //     for i in 0..5 {
    //         let agent_id = format!("agent{}", i);
    //         ctl.agent_add(agent_id.clone(), None).await;
    //         let _ = ctl.channel_join("room1", agent_id.clone()).await;
    //     }
    //
    //     // Remove channel
    //     ctl.channel_rm("room1".into()).await;
    //
    //     // Verify cleanup
    //     assert!(ctl.channels.lock().await.is_empty());
    //
    //     // Attempt to send message to removed channel
    //     let msg = create_test_message("room1", "1", "test");
    //     let result = ctl.channel_broadcast("room1".into(), msg).await;
    //     assert!(result.is_err());
    // }

    // ctl can be cloned?
    // Test simultaneous broadcasting
    // #[tokio::test]
    // async fn test_concurrent_broadcasting() {
    //     let ctl = ChannelControl::new();
    //     ctl.new_channel("room1".into(), None).await;
    //
    //     // Add multiple agents
    //     for i in 0..3 {
    //         let agent_id = format!("agent{}", i);
    //         ctl.add_agent(agent_id.clone(), None).await;
    //         let _ = ctl.join_channel("room1", agent_id).await;
    //     }
    //
    //     let mut handles = vec![];
    //
    //     // Spawn multiple tasks to broadcast messages
    //     for i in 0..5 {
    //         let ctl = ctl.clone();
    //         let handle = tokio::spawn(async move {
    //             let msg = create_test_message("room1", &i.to_string(), &format!("msg{}", i));
    //             ctl.broadcast("room1".into(), msg).await.unwrap();
    //         });
    //         handles.push(handle);
    //     }
    //
    //     // Wait for all broadcasts to complete
    //     for handle in handles {
    //         handle.await.unwrap();
    //     }
    // }

    #[test]
    fn test_reply_message_display() {
        // Test message response
        let message = ServerMessage {
            join_ref: Some("1".to_string()),
            event_ref: "ref1".to_string(),
            topic: "test".to_string(),
            event: "msg".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Message {
                    message: "hello".to_string(),
                },
            }),
        };
        assert_eq!(message.to_string(), r#"Message join_ref=1, ref=ref1, topic=test, event=msg, <Payload status=ok, response=...>"#);

        // Test datetime response
        let datetime = ServerMessage {
            join_ref: None,
            event_ref: "ref2".to_string(),
            topic: "system".to_string(),
            event: "datetime".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Datetime {
                    datetime: "2024-01-01T00:00:00".to_string(),
                    counter: 42,
                },
            }),
        };
        assert_eq!(datetime.to_string(), r#"Message join_ref=None, ref=ref2, topic=system, event=datetime, <Payload status=ok, response=...>"#);

        // Test empty response
        let empty = ServerMessage {
            join_ref: None,
            event_ref: "ref3".to_string(),
            topic: "test".to_string(),
            event: "phx_reply".to_string(),
            payload: ServerPayload::ServerResponse(ServerResponse {
                status: "ok".to_string(),
                response: Response::Empty {},
            }),
        };
        assert_eq!(empty.to_string(), r#"Message join_ref=None, ref=ref3, topic=test, event=phx_reply, <Payload status=ok, response=...>"#);
    }
}

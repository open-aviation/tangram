use futures::StreamExt;
use redis::RedisResult;
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::Entry, HashMap},
    error::Error,
    fmt::{self, Display},
    sync::{
        atomic::{AtomicU32, Ordering},
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
    /// channel name
    pub name: String,
    /// broadcast in channels
    pub tx: broadcast::Sender<ChannelMessage>,
    /// channel agents
    pub agents: Mutex<Vec<String>>,
    /// channel agent count
    pub count: AtomicU32,
    pub redis_listen_task: Option<JoinHandle<RedisResult<()>>>,
}

/// manages all channels
pub struct ChannelControl {
    pub channels: Mutex<HashMap<String, Channel>>, // channel name -> Channel

    /// agent_id -> Vec<agentTask>
    /// task forwarding channel messages to agent websocket tx
    /// created when agent joins a channel
    // agent_relay_tasks: Mutex<HashMap<String, Vec<ChannelAgent>>>, // agent_id -> JoinHandle
    agent_relay_task: Mutex<HashMap<String, ChannelAgent>>, // agent_id -> JoinHandle
    agent_tx: Mutex<HashMap<String, broadcast::Sender<ChannelMessage>>>, // agent_id -> Sender

    conn_tx: Mutex<HashMap<String, broadcast::Sender<ChannelMessage>>>, // conn_id -> Sender
}

impl Default for ChannelControl {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, PartialEq)]
pub enum ChannelError {
    ChannelNotFound,
    ChannelEmpty,
    MessageSendError,
    AgentNotInitiated,
}

impl Error for ChannelError {}

impl fmt::Display for ChannelError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ChannelError::ChannelNotFound => {
                write!(f, "<ChannelNotFound: channel not found>")
            }
            ChannelError::ChannelEmpty => {
                write!(f, "<ChannelEmpty: channel has not agents>")
            }
            ChannelError::AgentNotInitiated => {
                write!(f, "<AgentNotInitiated: agent not initiated>")
            }
            ChannelError::MessageSendError => {
                write!(f, "<MessageSendError: failed to send a message to the channel>")
            }
        }
    }
}

#[derive(Debug)]
struct ChannelAgent {
    channel_name: String,
    id: String,
    relay_task: JoinHandle<()>,
}

impl Display for ChannelAgent {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "<Agent: id={} channel={}, task={:?}>", self.id, self.channel_name, self.relay_task)
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
            info!("CHANNEL / total: {:?}, added {}", self.count, agent_id);
        } else {
            info!("CHANNEL / total: {:?}, {} exists", self.count, agent_id);
        }
        self.tx.clone()
    }

    pub async fn leave(&self, agent_id: String) {
        let mut agents = self.agents.lock().await;
        if let Some(pos) = agents.iter().position(|x| *x == agent_id) {
            // - 找到 index
            // - 删除 index 位置的，用最后一个顶替这个位置
            let agent = agents.swap_remove(pos);
            self.count.fetch_sub(1, Ordering::SeqCst);
            info!("CHANNEL / {:?}, removed {}", self.count, agent);
        }
    }

    /// broadcast messages to the channel
    /// it returns the number of agents who received the message
    pub fn send(&self, data: ChannelMessage) -> Result<usize, SendError<ChannelMessage>> {
        self.tx.send(data)
    }

    pub fn empty(&self) -> bool {
        self.count.load(Ordering::SeqCst) == 0
    }

    pub async fn agents(&self) -> tokio::sync::MutexGuard<Vec<String>> {
        self.agents.lock().await
    }
}

impl ChannelControl {
    pub fn new() -> Self {
        ChannelControl {
            channels: Mutex::new(HashMap::new()),
            // agent_relay_tasks: Mutex::new(HashMap::new()),
            agent_relay_task: Mutex::new(HashMap::new()),
            agent_tx: Mutex::new(HashMap::new()),
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

    // 清理所有和conn 有关的: conn, channel, agent
    // agent_id: {conn_id}:{channel}:{join_ref}
    pub async fn conn_cleanup(&self, conn_id: String) {
        self.agent_relay_task.lock().await.retain(|k, agent| {
            if k.starts_with(&conn_id) {
                agent.relay_task.abort();
                info!("CONN / {} relay task aborts.", agent.id);
            }
            info!("CONN / {} to be removed", agent.id);
            !k.starts_with(&conn_id)
        });
        let mut agent_tx = self.agent_tx.lock().await;
        debug!("CONN / cleanup agent_tx, conn_id: {}, {} {:?}", conn_id, agent_tx.len(), agent_tx.keys().collect::<Vec<&String>>());
        agent_tx.retain(|k, _| !k.starts_with(&conn_id));
        debug!("CONN / agent_tx cleared, conn_id: {}, {} {:?}", conn_id, agent_tx.len(), agent_tx.keys().collect::<Vec<&String>>());

        self.conn_tx.lock().await.remove_entry(&conn_id);
        debug!("CONN / conn cleared, {}", conn_id);
    }

    pub async fn channel_add(&self, channel_name: String, capacity: Option<usize>) {
        let mut channels = self.channels.lock().await;
        channels
            .entry(channel_name.clone())
            .or_insert_with(|| Channel::new(channel_name.clone(), capacity));
        // None if key does not exist, or value replace and old value retured
        // let inserted = channels.insert(channel_name.clone(), Channel::new(channel_name.clone(), capacity));
    }

    pub async fn channel_add_redis_listen_task(&self, channel_name: String, redis_listen_task: JoinHandle<RedisResult<()>>) {
        let mut channels = self.channels.lock().await;
        let channel = channels.get_mut(&channel_name).unwrap();
        channel.redis_listen_task = Some(redis_listen_task);
        info!("CH / added redis listen task to channel {}", channel_name);
    }

    // 删除一个 channel
    // channel 上所有的资源: channel, agents, agent_tx, relay_task, redis_listen_task, conn_tx
    pub async fn channel_remove(&self, channel_name: String) {
        match self.channels.lock().await.entry(channel_name.clone()) {
            Entry::Vacant(_) => {}
            Entry::Occupied(entry) => {
                let channel = entry.get();

                // channel agents
                //

                for agent_id in channel.agents().await.iter() {
                    if let Entry::Occupied(agent_task) = self.agent_relay_task.lock().await.entry(agent_id.into()) {
                        agent_task.get().relay_task.abort();
                        agent_task.remove();
                    }
                }
                if let Some(task) = &channel.redis_listen_task {
                    task.abort();
                    info!("CH / channel {} redis listen task aborted", channel_name);
                }

                entry.remove();
                info!("CH / removed from channels, {}", channel_name);
            }
        }
    }

    // pub async fn channel_rm_conn_agents(&self, conn_id: String) {
    //     for (name, channel) in self.channels.lock().await.iter() {
    //         let mut agents = channel.agents.lock().await;
    //         debug!("CH / {}, agents {} {:?}", name, agents.len(), agents);
    //         agents.retain(|agent| !agent.starts_with(&conn_id));
    //         debug!("CH / {}, removed agents of conn {}, agents {} {:?}", name, conn_id, agents.len(), agents);
    //     }
    // }

    pub async fn channel_exists(&self, channel_name: &str) -> bool {
        let channels = self.channels.lock().await;
        channels.contains_key(channel_name)
    }
    /// join agent to a channel
    pub async fn channel_join(&self, channel_name: &str, agent_id: String) -> Result<broadcast::Sender<ChannelMessage>, ChannelError> {
        let channels = self.channels.lock().await;

        // join
        let channel = channels.get(channel_name).ok_or(ChannelError::ChannelNotFound)?;
        let channel_tx = channel.join(agent_id.clone()).await;
        let mut channel_rx = channel_tx.subscribe();
        let agent_tx = self.agent_tx.lock().await.get(&agent_id).ok_or(ChannelError::AgentNotInitiated)?.clone();

        // 订阅 channel 并将消息转发给 agent
        let relay_task = tokio::spawn(async move {
            while let Ok(channel_message) = channel_rx.recv().await {
                match &channel_message {
                    ChannelMessage::Reply(_reply_message) => {
                        let _ = agent_tx.send(channel_message);
                    }
                }
            }
        });

        match self.agent_relay_task.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(_) => {
                warn!("AGENT / {} already has a relay task", agent_id);
            }
            Entry::Vacant(entry) => {
                entry.insert(ChannelAgent {
                    id: agent_id,
                    channel_name: channel_name.to_string().clone(),
                    relay_task,
                });
            }
        }
        Ok(channel_tx)
    }

    pub async fn channel_leave(&self, name: String, agent_id: String) -> Result<(), ChannelError> {
        info!("CH / leave {} from {} ...", agent_id, name);
        let channels = self.channels.lock().await;
        channels.get(&name).ok_or(ChannelError::ChannelNotFound)?.leave(agent_id.clone()).await;
        match self.agent_relay_task.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.get().relay_task.abort();
                entry.remove();
                debug!("AGENT / {} relay task removed", agent_id);
            }
            Entry::Vacant(_) => {}
        }
        Ok(())
    }

    /// broadcast message to the channel
    /// it returns the number of agents who received the message
    pub async fn channel_broadcast(&self, channel_name: String, message: ChannelMessage) -> Result<usize, ChannelError> {
        let channels = self.channels.lock().await;
        let channel = channels.get(&channel_name).ok_or(ChannelError::ChannelNotFound)?;
        if channel.agents.lock().await.is_empty() {
            warn!("CH / no agents, no broadcasting");
            return Err(ChannelError::ChannelEmpty);
        }

        channel.send(message).map_err(|e| {
            error!("CH / broadcasting error, channel: {}, {:?}", channel_name, e);
            ChannelError::MessageSendError
        })
    }

    pub async fn agent_rx(&self, agent_id: String) -> Result<broadcast::Receiver<ChannelMessage>, ChannelError> {
        Ok(self.agent_tx.lock().await.get(&agent_id).ok_or(ChannelError::AgentNotInitiated)?.subscribe())
    }

    /// Add channel agent to the channel ctl, 就是添加 agent tx
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

    /// remove the agent after leaving all channels
    pub async fn agent_rm(&self, agent_id: String) {
        match self.agent_relay_task.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.get().relay_task.abort();
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
        // Channel agents 中的也需要删除
        for channel in self.channels.lock().await.values() {
            channel.leave(agent_id.clone()).await;
        }

        let agents = self.agent_list().await;
        info!("AGENT / list {} {:?}", agents.len(), agents);
    }

    /// list all agents
    pub async fn agent_list(&self) -> Vec<String> {
        self.agent_tx.lock().await.keys().cloned().collect()
    }
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

/// 从redis 监听消息, per channel 的任务
pub async fn listen_to_redis(state: Arc<State>, channel_name: String) -> RedisResult<()> {
    let redis_topic = format!("to:{}:*", channel_name);
    let mut redis_pubsub = state.redis_client.get_async_pubsub().await?;
    redis_pubsub.psubscribe(redis_topic.clone()).await?;
    let mut redis_pubsub_stream = redis_pubsub.on_message();
    let mut counter = 0; // TODO: counter 有问题, 在这里完全没有意义

    info!("LISTENER / subscribed to redis, channel: {}", redis_topic);
    loop {
        let optional_message = redis_pubsub_stream.next().await;
        if optional_message.is_none() {
            error!("LISTENER / from redis: none");
            continue;
        }

        let stream_message = optional_message.unwrap();
        let payload: String = stream_message.get_payload()?;
        debug!("LISTENER / from redis, {}, payload: `{}`", stream_message.get_channel_name(), payload.clone());

        let response_from_redis_result = serde_json::from_str::<serde_json::Value>(&payload);
        if response_from_redis_result.is_err() {
            warn!("LISTENER / fail to deserialize from Redis, {}, payload: `{}`", response_from_redis_result.err().unwrap(), payload);
            continue;
        }
        // let response_from_redis = response_from_redis_result.unwrap();
        // let resp: Response = response_from_redis.into();
        // debug!("LISTENER / parsed from redis, response: {:?}", &resp);

        let value = response_from_redis_result.unwrap();
        debug!("LISTENER / parsed from redis, value: {:?}", &value);

        // the format is to:channel_name:event_name, split it by `:`
        match ChannelEventFromRedis::parse(stream_message.get_channel_name()) {
            Ok(msg) => {
                _channel_publish(counter, value.clone(), state.clone(), &msg.channel, &msg.event).await;
            }
            Err(e) => {
                warn!("LISTENER / invalid redis channel format: {}", e);
                continue;
            }
        }
        counter += 1;
        debug!("LISTENER / publish message from redis, counter: {}", counter);
    }
}

async fn _channel_publish(counter: i32, value: serde_json::Value, state: Arc<State>, channel_name: &str, event_name: &str) {
    let reply_message = ServerMessage {
        join_ref: None,
        event_ref: counter.to_string(),
        topic: channel_name.to_string(),
        event: event_name.to_string(),
        payload: ServerPayload::ServerJsonValue(value),
    };
    match state
        .ctl
        .lock()
        .await
        .channel_broadcast(channel_name.to_string(), ChannelMessage::Reply(reply_message.clone()))
        .await
    {
        Ok(_) => debug!("REDIS_PUB / published, {} > {}", event_name, reply_message),
        Err(e) => {
            // it throws error if there's no client
            error!("REDIS_PUB / fail to send, channel: {}, event: {}, err: {}", channel_name, event_name, e);
        }
    }
}

#[cfg(test)]
mod test {
    use crate::channel::{Channel, ChannelControl, ChannelError, ChannelMessage};
    use crate::websocket::{Response, ServerMessage, ServerPayload};

    fn create_test_message(topic: &str, reference: &str, message: &str) -> ChannelMessage {
        ChannelMessage::Reply(ServerMessage {
            join_ref: None,
            event_ref: reference.to_string(),
            topic: topic.to_string(),
            event: "test_event".to_string(),
            payload: ServerPayload {
                status: "ok".to_string(),
                // response: json!({
                //     "message": message.to_string(),
                // }),
                response: Response::Message { message: message.to_string() },
            },
        })
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

            // let value = from_value(msg.payload.response);
            if let Response::Message { message } = msg.payload.response {
                assert_eq!(message, "hello");
            } else {
                panic!("Wrong response type");
            }
        } else {
            panic!("Failed to receive message");
        }
    }

    // FIXME: Test is flaky
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
        let ctl = ChannelControl::new();

        // Test non-existent channel
        let result = ctl.channel_join("nonexistent", "user1".into()).await;
        assert!(matches!(result.unwrap_err(), ChannelError::ChannelNotFound));

        // Test non-initiated agent
        ctl.channel_add("room1".into(), None).await;
        let result = ctl.channel_join("room1", "user1".into()).await;
        assert!(matches!(result.unwrap_err(), ChannelError::AgentNotInitiated));

        // Test leave non-existent channel
        let result = ctl.channel_leave("nonexistent".into(), "user1".into()).await;
        assert!(matches!(result.unwrap_err(), ChannelError::ChannelNotFound));
    }

    #[tokio::test]
    async fn test_agent_subscription() {
        let ctl = ChannelControl::new();

        // Setup channels and agent
        ctl.channel_add("room1".into(), None).await;
        ctl.agent_add("user1".into(), None).await;

        // Test subscription before join
        let sub = ctl.agent_rx("user1".into()).await;
        assert!(sub.is_ok());

        // Join channel and test broadcasting
        ctl.channel_join("room1", "user1".into()).await.unwrap();
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
        let ctl = ChannelControl::new();
        assert_eq!(ctl.channels.lock().await.len(), 0);
        // assert!(ctl.empty().await, "Should have no channels");

        ctl.channel_add("test".into(), None).await;
        assert_eq!(ctl.channels.lock().await.len(), 1);

        ctl.channel_remove("test".into()).await;
        assert_eq!(ctl.channels.lock().await.len(), 0);
    }

    #[tokio::test]
    async fn test_join_leave() {
        let ctl = ChannelControl::new();

        ctl.channel_add("test".into(), None).await; // new channel

        // new agent
        let agent_id = "agent1".to_string();
        ctl.agent_add(agent_id.clone(), None).await;

        // join channel
        let result = ctl.channel_join("test", agent_id.clone()).await;
        assert!(result.is_ok(), "Should successfully join channel");

        // leave channel
        let result = ctl.channel_leave("test".to_string(), agent_id.clone()).await;
        assert!(result.is_ok(), "Should successfully leave channel");
    }

    #[tokio::test]
    async fn test_channel_basics() {
        let ctl = ChannelControl::new();

        // new channel
        ctl.channel_add("test".into(), None).await;

        // new agent
        let agent_id = "agent1".to_string();
        ctl.agent_add(agent_id.clone(), None).await;

        // join channel
        let result = ctl.channel_join("test", agent_id.clone()).await;
        assert!(result.is_ok(), "Should successfully join channel");

        // broadcast message
        let message = ChannelMessage::Reply(ServerMessage {
            join_ref: None,
            event_ref: "1".to_string(),
            topic: "test".to_string(),
            event: "test_event".to_string(),
            payload: crate::websocket::ServerPayload {
                status: "ok".to_string(),
                // response: json!({
                //     "message": "test message".to_string(),
                // }),
                response: Response::Message {
                    message: "test message".to_string(),
                },
            },
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
        let ctl = ChannelControl::new();
        ctl.channel_add("room1".into(), None).await;

        // Add multiple agents
        let agent_ids = vec!["agent1", "agent2", "agent3"];
        for agent_id in &agent_ids {
            ctl.agent_add(agent_id.to_string(), None).await;
            let result = ctl.channel_join("room1", agent_id.to_string()).await;
            assert!(result.is_ok(), "Agent should join successfully");
        }

        // Broadcast a message
        let message = ChannelMessage::Reply(ServerMessage {
            join_ref: None,
            event_ref: "1".to_string(),
            topic: "room1".to_string(),
            event: "broadcast".to_string(),
            payload: crate::websocket::ServerPayload {
                status: "ok".to_string(),
                // response: json!({
                //     "message": "hello all".to_string(),
                // }),
                response: Response::Message {
                    message: "hello all".to_string(),
                },
            },
        });

        let result = ctl.channel_broadcast("room1".to_string(), message).await;
        assert!(result.is_ok(), "Should successfully broadcast");
        assert_eq!(result.unwrap(), 3, "Should have 3 receivers");
    }

    // ctl 可以 clone 么?
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
        let ctl = ChannelControl::new();
        ctl.channel_add("room1".into(), None).await;
        ctl.agent_add("agent1".into(), None).await;

        let _ = ctl.channel_join("room1", "agent1".into()).await.unwrap();

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
        let ctl = ChannelControl::new();

        // Test joining non-existent channel
        let result = ctl.channel_join("nonexistent", "agent1".into()).await;
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
        let ctl = ChannelControl::new();
        ctl.channel_add("room1".into(), None).await;

        // Add multiple agents and join channel
        for i in 0..5 {
            let agent_id = format!("agent{}", i);
            ctl.agent_add(agent_id.clone(), None).await;
            let _ = ctl.channel_join("room1", agent_id.clone()).await;
        }

        // Remove channel
        ctl.channel_remove("room1".into()).await;

        // Verify cleanup
        assert!(ctl.channels.lock().await.is_empty());

        // Attempt to send message to removed channel
        let msg = create_test_message("room1", "1", "test");
        let result = ctl.channel_broadcast("room1".into(), msg).await;
        assert!(result.is_err());
    }

    // ctl 可以 clone 么?
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
            payload: ServerPayload {
                status: "ok".to_string(),
                // response: json!({
                //     "message": "hello".to_string(),
                // }),
                response: Response::Message { message: "hello".to_string() },
            },
        };
        assert_eq!(message.to_string(), r#"Message join_ref=1, ref=ref1, topic=test, event=msg, <Payload status=ok, response=...>"#);

        // Test datetime response
        let datetime = ServerMessage {
            join_ref: None,
            event_ref: "ref2".to_string(),
            topic: "system".to_string(),
            event: "datetime".to_string(),
            payload: ServerPayload {
                status: "ok".to_string(),
                // response: json!({
                //     "datetime": "2024-01-01T00:00:00".to_string(),
                //     "counter": 42,
                // }),
                response: Response::Datetime {
                    datetime: "2024-01-01T00:00:00".to_string(),
                    counter: 42,
                },
            },
        };
        assert_eq!(datetime.to_string(), r#"Message join_ref=None, ref=ref2, topic=system, event=datetime, <Payload status=ok, response=...>"#);

        // Test empty response
        let empty = ServerMessage {
            join_ref: None,
            event_ref: "ref3".to_string(),
            topic: "test".to_string(),
            event: "phx_reply".to_string(),
            payload: ServerPayload {
                status: "ok".to_string(),
                // response: json!({}),
                response: Response::Empty {},
            },
        };
        assert_eq!(empty.to_string(), r#"Message join_ref=None, ref=ref3, topic=test, event=phx_reply, <Payload status=ok, response=...>"#);
    }
}

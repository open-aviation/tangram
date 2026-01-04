pub mod utils;
pub mod websocket;

use futures::StreamExt;
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
use tracing::{debug, error, info, instrument, warn};

use websocket::{is_special_channel, Response, ServerMessage, ServerPayload, State};

/// Internal message type for broadcasting within the rust process.
///
/// Wraps `ServerMessage` which is serializable to the phoenix v2 json format.
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

/// Represents a specific topic instance (e.g., "room:123").
///
/// Equivalent to a `Phoenix.Channel` `GenServer` process.
/// Unlike Phoenix, where each *join* spawns a process, this struct is a shared
/// hub for *all* local agents subscribed to this topic.
///
/// # Limitations
/// - guarded by a mutex; high contention on join/leave.
/// - Uses `tokio::sync::broadcast` (ring buffer). Slow clients
///   will lag and drop messages (`RecvError::Lagged`). Phoenix mailboxes grow unbounded (until OOM).
/// - `tx` (`broadcast::Sender`) does **not** propagate backpressure to upstream
///   publishers (including Redis or local producers). If a websocket or relay
///   task is slow the relay will observe `Lagged` errors and drop messages.
pub struct Channel {
    pub name: String,
    /// Broadcast sender for distributing messages to all local agents.
    pub tx: broadcast::Sender<ChannelMessage>,
    /// List of agent IDs currently joined.
    pub agents: Mutex<Vec<String>>,
    /// Active subscriber count.
    pub count: AtomicU32,
    /// Handle to the task listening to Redis `to:<channel>` events.
    pub redis_listen_task: Option<JoinHandle<RedisResult<()>>>,
}

/// Global orchestrator for connection state, channels, and Redis integration.
///
/// Combines responsibilities of `Phoenix.PubSub` (routing), `Phoenix.Socket` (transport state),
/// and `Phoenix.Presence` (tracking).
///
/// - Channels: Map of `String` -> `Channel`.
/// - Agents: Map of unique agent IDs to their relay tasks.
/// - Connections: Tracks physical websocket connections and their associated agents.
pub struct ChannelControl {
    /// Registry of active channels.
    pub channels: Mutex<HashMap<String, Channel>>,
    redis_client: Arc<redis::Client>,
    /// Map of `agent_id` -> `Agent` struct (metadata + relay task).
    pub agents: Mutex<HashMap<String, Agent>>,
    /// Map of `agent_id` -> `broadcast::Sender` (how we send to a specific agent's relay).
    agent_tx: Mutex<HashMap<String, broadcast::Sender<ChannelMessage>>>,
    /// Map of `conn_id` -> list of `agent_id`s (multiplexing support).
    conn_agents: Mutex<HashMap<String, Vec<String>>>,
    /// Map of `conn_id` -> `broadcast::Sender` (egress to websocket).
    conn_tx: Mutex<HashMap<String, broadcast::Sender<ChannelMessage>>>,
}

/// Represents a single subscription of a Connection to a Channel.
///
/// Conceptually similar to the state inside a `Phoenix.Channel` process, mostly `socket.assigns`
/// combined with the process ID logic.
#[derive(Debug)]
pub struct Agent {
    pub channel: String,
    /// Unique internal ID: `{conn_id}:{channel}:{join_ref}`.
    pub id: String,
    /// ID from JWT (user ID).
    pub external_id: String,
    /// Task forwarding messages from the Channel broadcast to the Connection tx.
    relay_task: JoinHandle<()>,
}

impl Display for Agent {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(
            f,
            "<Agent: id={} external_id={} channel={}, task={:?}>",
            self.id, self.external_id, self.channel, self.relay_task
        )
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
            ChannelError::ChannelEmpty => {
                write!(formatter, "<ChannelEmpty: channel has not agents>")
            }
            ChannelError::AgentNotInitiated => write!(formatter, "<AgentNotInitiated>"),
            ChannelError::MessageSendError => write!(
                formatter,
                "<MessageSendError: failed to send a message to the channel>"
            ),
            ChannelError::BadToken => write!(formatter, "<InvalidPayload: invalid payload format>"),
        }
    }
}

impl Channel {
    /// Creates a new Channel with a bounded broadcast capacity.
    ///
    /// # capacity
    /// If agents consume slower than broadcast, they will see `Lagged` errors and miss messages.
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

    /// Registers an agent (client) to this channel.
    ///
    /// Comparable to `Phoenix.PubSub.subscribe/3`.
    /// Note: Does not handle the authentication logic; that happens in `ChannelControl`.
    #[instrument(skip(self), fields(channel = %self.name))]
    pub async fn join(&self, agent_id: String) -> broadcast::Sender<ChannelMessage> {
        let mut agents = self.agents.lock().await;
        if !agents.contains(&agent_id) {
            agents.push(agent_id.clone());
            self.count.fetch_add(1, Ordering::SeqCst);
            info!(total = ?self.count, %agent_id, "agent added");
        } else {
            info!(total = ?self.count, %agent_id, "agent exists");
        }
        self.tx.clone()
    }

    #[instrument(skip(self), fields(channel = %self.name))]
    pub async fn leave(&self, agent_id: String) {
        let mut agents = self.agents.lock().await;
        if let Some(pos) = agents.iter().position(|x| *x == agent_id) {
            // efficient removal: swap with last element, then pop.
            let agent = agents.swap_remove(pos);
            self.count.fetch_sub(1, Ordering::SeqCst);
            info!(total = ?self.count, removed_agent = %agent, "agent removed");
        }
    }

    /// Broadcasts a message to all local agents.
    /// Returns the number of active receivers.
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
            conn_agents: Mutex::new(HashMap::new()),
        }
    }

    /// Registers a new Websocket connection (transport level).
    ///
    /// Similar to a `Phoenix.Socket` process starting up.
    #[instrument(skip(self), fields(conn_id = %conn_id))]
    pub async fn conn_add_tx(&self, conn_id: String) {
        let mut conn_tx = self.conn_tx.lock().await;
        match conn_tx.entry(conn_id.clone()) {
            Entry::Vacant(entry) => {
                let (tx, _rx) = broadcast::channel(100);
                entry.insert(tx);
                debug!("connection tx added");
            }
            Entry::Occupied(_) => {}
        }
    }

    /// Subscribes to the outbound stream for a specific connection.
    /// Used by the websocket writer task.
    pub async fn conn_rx(
        &self,
        conn_id: String,
    ) -> Result<broadcast::Receiver<ChannelMessage>, ChannelError> {
        Ok(self.conn_tx.lock().await.get(&conn_id).unwrap().subscribe())
    }

    pub async fn conn_tx(
        &self,
        conn_id: String,
    ) -> Result<broadcast::Sender<ChannelMessage>, ChannelError> {
        Ok(self.conn_tx.lock().await.get(&conn_id).unwrap().clone())
    }

    pub async fn conn_send(
        &self,
        conn_id: String,
        message: ChannelMessage,
    ) -> Result<usize, ChannelError> {
        self.conn_tx
            .lock()
            .await
            .get(&conn_id)
            .ok_or(ChannelError::ChannelNotFound)?
            .send(message)
            .map_err(|_| ChannelError::MessageSendError)
    }

    /// Checks if a channel has no agents and removes it to prevent leaks.
    ///
    /// Phoenix channel processes terminate automatically when the last client leaves (if programmed)
    /// or when the supervisor kills them. Here we must explicitly GC empty channels.
    #[instrument(skip(self), fields(channel = %channel_name))]
    pub async fn channel_remove_if_empty(&self, channel_name: String) -> bool {
        let mut channels = self.channels.lock().await;

        if let Some(channel) = channels.get(&channel_name) {
            if !channel.empty() {
                return false;
            }

            for agent_id in channel.agents().await.iter() {
                if let Entry::Occupied(agent_task) = self.agents.lock().await.entry(agent_id.into())
                {
                    agent_task.get().relay_task.abort();
                    agent_task.remove();
                }
            }
            if let Some(task) = &channel.redis_listen_task {
                task.abort();
            }

            channels.remove(&channel_name);

            let channel_names = channels.keys().cloned().collect::<Vec<String>>();
            let meta = json!({"channel": channel_name, "channels": channel_names});
            self.pub_meta_event("channel".into(), "remove".into(), meta)
                .await;

            info!("safely removed empty channel");
            return true;
        }
        false
    }

    /// Terminates all agents associated with a connection.
    ///
    /// Equivalent to the `terminate/2` callback in `Phoenix.Channel` when the socket closes (`{:shutdown, :closed}`).
    /// Also handles Presence `leave` events.
    #[instrument(skip(self), fields(conn_id = %conn_id))]
    pub async fn conn_cleanup(&self, conn_id: String) {
        let agents_to_remove = {
            let mut ca = self.conn_agents.lock().await;
            ca.remove(&conn_id).unwrap_or_default()
        };

        if agents_to_remove.is_empty() {
            self.conn_tx.lock().await.remove(&conn_id);
            return;
        }

        info!(agents_count = agents_to_remove.len(), "cleanup connection");

        struct AgentInfo {
            id: String,
            channel: String,
            external_id: String,
        }
        let mut agent_infos = Vec::new();

        {
            let mut agents_map = self.agents.lock().await;
            for agent_id in &agents_to_remove {
                if let Some(agent) = agents_map.remove(agent_id) {
                    agent.relay_task.abort();
                    agent_infos.push(AgentInfo {
                        id: agent.id,
                        channel: agent.channel,
                        external_id: agent.external_id,
                    });
                }
            }
        }

        {
            let mut agent_tx_map = self.agent_tx.lock().await;
            for agent_id in &agents_to_remove {
                agent_tx_map.remove(agent_id);
            }
        }
        self.conn_tx.lock().await.remove(&conn_id);

        let mut by_channel: HashMap<String, Vec<&AgentInfo>> = HashMap::new();
        for info in &agent_infos {
            by_channel
                .entry(info.channel.clone())
                .or_default()
                .push(info);
        }

        let redis_conn_result = self.redis_client.get_multiplexed_async_connection().await;
        let mut redis_conn = redis_conn_result.ok();

        for (channel_name, infos) in by_channel {
            let mut leaves: HashMap<String, serde_json::Value> = HashMap::new();
            for info in infos.iter() {
                let metas = leaves
                    .entry(info.external_id.clone())
                    .or_insert_with(|| json!({"metas": []}));
                if let Some(arr) = metas.get_mut("metas").and_then(|m| m.as_array_mut()) {
                    arr.push(json!({"phx_ref": info.id}));
                }
            }

            if let Some(ref mut conn) = redis_conn {
                let diff = json!({"joins": {}, "leaves": leaves});
                let redis_topic = format!("to:{}:presence_diff", channel_name);
                let _ = conn
                    .publish::<_, _, ()>(redis_topic, diff.to_string())
                    .await;
            }

            let maybe_empty = {
                let channels = self.channels.lock().await;
                if let Some(channel) = channels.get(&channel_name) {
                    let mut ca = channel.agents.lock().await;
                    for info in &infos {
                        if let Some(pos) = ca.iter().position(|x| *x == info.id) {
                            ca.swap_remove(pos);
                            channel.count.fetch_sub(1, Ordering::SeqCst);
                        }
                    }
                    ca.is_empty()
                } else {
                    false
                }
            };

            if maybe_empty && !is_special_channel(&channel_name) {
                self.channel_remove_if_empty(channel_name).await;
            }
        }
    }

    #[instrument(skip(self), fields(channel = %channel_name))]
    pub async fn channel_add(&self, channel_name: String, capacity: Option<usize>) {
        let mut channels = self.channels.lock().await;
        channels
            .entry(channel_name.clone())
            .or_insert_with(|| Channel::new(channel_name.clone(), capacity));
        debug!("channel added");
    }

    #[instrument(skip(self, redis_listen_task), fields(channel = %channel_name))]
    pub async fn channel_add_redis_listen_task(
        &self,
        channel_name: String,
        redis_listen_task: JoinHandle<RedisResult<()>>,
    ) {
        let mut channels = self.channels.lock().await;
        let channel = channels.get_mut(&channel_name).unwrap();
        channel.redis_listen_task = Some(redis_listen_task);
        info!("added redis listen task");

        let meta = json!({"channel": channel_name});
        self.pub_meta_event("channel".into(), "add-redis-listener".into(), meta)
            .await;
    }

    /// Publishes internal meta events to Redis (e.g., admin dashboard updates).
    #[instrument(skip(self, meta))]
    pub async fn pub_meta_event(&self, topic: String, event: String, meta: serde_json::Value) {
        let redis_topic = format!("to:admin:{}.{}", topic, event);

        let redis_conn_result = self
            .redis_client
            .clone()
            .get_multiplexed_async_connection()
            .await;
        if redis_conn_result.is_err() {
            error!("fail to get redis connection");
            return;
        }

        let message = serde_json::to_string(&meta).unwrap();
        let result: RedisResult<String> = redis_conn_result
            .unwrap()
            .publish(redis_topic, message.clone())
            .await;
        if result.is_err() {
            error!("fail to publish to redis");
            return;
        }

        debug!("event published to redis");
    }

    /// Forcefully deletes a channel and all its agents.
    #[instrument(skip(self), fields(channel = %channel_name))]
    pub async fn channel_rm(&self, channel_name: String) {
        let mut channels = self.channels.lock().await;
        match channels.entry(channel_name.clone()) {
            Entry::Vacant(_) => {}
            Entry::Occupied(entry) => {
                let channel = entry.get();
                for agent_id in channel.agents().await.iter() {
                    if let Entry::Occupied(agent_task) =
                        self.agents.lock().await.entry(agent_id.into())
                    {
                        agent_task.get().relay_task.abort();
                        info!(agent_id = %agent_id, "relay_task aborted");
                        agent_task.remove();
                    }
                }
                if let Some(task) = &channel.redis_listen_task {
                    task.abort();
                    info!("redis listen task aborted");
                }

                entry.remove();
                info!("removed from channels");
            }
        }
        let channel_names = channels.keys().cloned().collect::<Vec<String>>();

        let meta = json!({"channel": channel_name, "channels": channel_names});
        self.pub_meta_event("channel".into(), "remove".into(), meta)
            .await;

        info!(
            channels_count = channel_names.len(),
            ?channel_names,
            "channel cleared"
        );
    }

    pub async fn channel_exists(&self, channel_name: &str) -> bool {
        let channels = self.channels.lock().await;
        channels.contains_key(channel_name)
    }

    /// Joins an agent to a channel.
    ///
    /// This sets up the relay task: `Channel Broadcast` -> `Agent TX` -> `Agent Relay` -> `Connection TX`.
    ///
    /// Similar to `Phoenix.Channel.join/3` logic, but where Phoenix spawns a `GenServer` that handles
    /// the socket state and communication, this spawns a lightweight `tokio` task that
    /// bridges the broadcast bus to the websocket output.
    #[instrument(skip(self), fields(channel = %channel_name))]
    pub async fn channel_join(
        &self,
        channel_name: &str,
        agent_id: String,
        external_id: String,
    ) -> Result<broadcast::Sender<ChannelMessage>, ChannelError> {
        let channels = self.channels.lock().await;

        // join
        let channel = channels
            .get(channel_name)
            .ok_or(ChannelError::ChannelNotFound)?;
        let channel_tx = channel.join(agent_id.clone()).await;
        let mut channel_rx = channel_tx.subscribe();
        let agent_tx = self
            .agent_tx
            .lock()
            .await
            .get(&agent_id)
            .ok_or(ChannelError::AgentNotInitiated)?
            .clone();

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
                warn!(%agent_id, "already has a relay task");
                // TODO: Should we abort the old one? Phoenix kills old channel on duplicate join.
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
        self.pub_meta_event("channel".into(), "join".into(), meta)
            .await;

        let parts: Vec<&str> = agent_id.split(':').collect();
        if let Some(conn_id) = parts.first() {
            self.conn_agents
                .lock()
                .await
                .entry(conn_id.to_string())
                .or_default()
                .push(agent_id.clone());
        }

        Ok(channel_tx)
    }

    #[instrument(skip(self), fields(channel = %channel_name))]
    pub async fn channel_leave(
        &self,
        channel_name: String,
        agent_id: String,
    ) -> Result<usize, ChannelError> {
        info!("leaving channel...");
        let channels = self.channels.lock().await;
        let channel = channels
            .get(&channel_name)
            .ok_or(ChannelError::ChannelNotFound)?;
        channel.leave(agent_id.clone()).await;
        match self.agents.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.get().relay_task.abort();
                entry.remove();
                debug!(%agent_id, "relay task removed");
            }
            Entry::Vacant(_) => {}
        }

        let meta = json!({"agent": agent_id.clone(), "channel": channel_name.clone(), "agents": *channel.agents.lock().await});
        self.pub_meta_event("channel".into(), "leave".into(), meta)
            .await;

        let parts: Vec<&str> = agent_id.split(':').collect();
        if let Some(conn_id) = parts.first() {
            let mut ca = self.conn_agents.lock().await;
            if let Some(agents) = ca.get_mut(*conn_id) {
                if let Some(pos) = agents.iter().position(|x| *x == agent_id) {
                    agents.swap_remove(pos);
                }
            }
        }

        Ok(channel.count.load(Ordering::SeqCst) as usize)
    }

    pub async fn channel_broadcast_json(
        &self,
        channel_name: &str,
        event_name: &str,
        value: serde_json::Value,
    ) -> Result<usize, ChannelError> {
        let message = ServerMessage {
            join_ref: None,
            event_ref: "0".into(),
            topic: channel_name.to_string(),
            event: event_name.to_string(),
            payload: ServerPayload::ServerJsonValue(value),
        };
        self.channel_broadcast(channel_name.to_string(), ChannelMessage::Reply(message))
            .await
    }

    /// Broadcasts a message to all agents in a channel.
    ///
    /// Equivalent to `Phoenix.Channel.broadcast/3`.
    ///
    /// - `intercept/1` is not supported here. Messages go to all agents.
    #[instrument(skip(self, message), fields(channel = %channel_name))]
    pub async fn channel_broadcast(
        &self,
        channel_name: String,
        message: ChannelMessage,
    ) -> Result<usize, ChannelError> {
        let channels = self.channels.lock().await;
        let channel = channels
            .get(&channel_name)
            .ok_or(ChannelError::ChannelNotFound)?;
        if channel.agents.lock().await.is_empty() {
            return Err(ChannelError::ChannelEmpty);
        }

        channel.send(message).map_err(|e| {
            error!(
                error = ?e,
                "broadcasting error"
            );
            ChannelError::MessageSendError
        })
    }

    pub async fn agent_rx(
        &self,
        agent_id: String,
    ) -> Result<broadcast::Receiver<ChannelMessage>, ChannelError> {
        Ok(self
            .agent_tx
            .lock()
            .await
            .get(&agent_id)
            .ok_or(ChannelError::AgentNotInitiated)?
            .subscribe())
    }

    /// Initialises the broadcast channel for an agent.
    /// This must be called before `channel_join`.
    #[instrument(skip(self), fields(agent_id = %agent_id))]
    pub async fn agent_add(&self, agent_id: String, capacity: Option<usize>) {
        match self.agent_tx.lock().await.entry(agent_id.clone()) {
            Entry::Vacant(entry) => {
                let (tx, _rx) = broadcast::channel(capacity.unwrap_or(100));
                entry.insert(tx);
                info!("added agent");
            }
            Entry::Occupied(_) => {
                info!("agent already exists");
            }
        }

        let agents = self.agent_list().await;
        debug!(agents_count = agents.len(), ?agents, "agent list");
    }

    /// Removes an agent completely.
    /// Returns the external_id if the agent existed.
    #[instrument(skip(self), fields(agent_id = %agent_id))]
    pub async fn agent_rm(&self, agent_id: String) -> Option<String> {
        let mut external_id: Option<String> = None;

        match self.agents.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.get().relay_task.abort();
                external_id = Some(entry.get().external_id.clone());
                entry.remove();
                debug!("relay task removed");
            }
            Entry::Vacant(_) => {}
        }

        match self.agent_tx.lock().await.entry(agent_id.clone()) {
            Entry::Occupied(entry) => {
                entry.remove();
                debug!("tx removed");
            }
            Entry::Vacant(_) => {}
        }
        // Also need to remove from Channel agents list
        for channel in self.channels.lock().await.values() {
            channel.leave(agent_id.clone()).await;
        }

        let agents = self.agent_list().await;
        info!(agents_count = agents.len(), ?agents, "agent list");

        external_id
    }

    pub async fn agent_list(&self) -> Vec<String> {
        self.agent_tx.lock().await.keys().cloned().collect()
    }
}

/// Represents the structure of messages coming FROM Redis TO the Channel.
///
/// - Strictly relies on the `type` field in the JSON payload.
/// - Does not support binary payloads (Arrow RecordBatches) yet.
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
            ResponseFromRedis::Datetime { datetime, counter } => {
                Response::Datetime { datetime, counter }
            }
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

/// Task that subscribes to Redis `to:<channel>:*` patterns and forwards messages to the Channel.
///
/// This task performs payload deserialization (JSON -> `serde_json::Value` ->
/// `ServerMessage`) inline, a CPU bottleneck.
#[instrument(skip(state, tx, redis_client), fields(channel = %channel_name))]
pub async fn listen_to_redis(
    state: Arc<State>,
    tx: broadcast::Sender<ChannelMessage>,
    redis_client: redis::Client,
    channel_name: String,
) -> RedisResult<()> {
    let redis_topic = format!("to:{}:*", channel_name);
    let mut redis_pubsub = redis_client.get_async_pubsub().await?;
    redis_pubsub.psubscribe(redis_topic.clone()).await?;
    let mut redis_pubsub_stream = redis_pubsub.on_message();
    let counter = Arc::new(AtomicU64::new(0));

    info!(redis_topic = %redis_topic, "subscribed to redis");

    loop {
        let Some(stream_message) = redis_pubsub_stream.next().await else {
            error!("stream ended");
            break;
        };

        let ev = match ChannelEventFromRedis::parse(stream_message.get_channel_name()) {
            Ok(ev) => ev,
            Err(err) => {
                warn!(
                    error = %err,
                    channel = %stream_message.get_channel_name(),
                    "parse error"
                );
                continue;
            }
        };

        let payload: String = match stream_message.get_payload() {
            Ok(p) => p,
            Err(e) => {
                error!("payload error: {}", e);
                continue;
            }
        };

        // NOTE: Accept any JSON payload, don't enforce internal strict types
        // TODO: Binary Payload (Arrow) support should be handled here by checking event prefix or type
        let value = match serde_json::from_str::<serde_json::Value>(&payload) {
            Ok(v) => v,
            Err(e) => {
                warn!("json error: {} in {}", e, payload);
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
        if tx.send(ChannelMessage::Reply(reply_message)).is_err() {
            debug!("no subscribers");
        }
    }

    // Cleanup reference in control struct
    let ctl = state.ctl.lock().await;
    let mut channels = ctl.channels.lock().await;
    if let Some(channel) = channels.get_mut(&channel_name) {
        channel.redis_listen_task = None;
    }

    Ok(())
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use tokio::sync::broadcast;

    use crate::channel::utils::random_string;
    use crate::channel::websocket::{Response, ServerMessage, ServerPayload, ServerResponse};
    use crate::channel::{Channel, ChannelControl, ChannelError, ChannelMessage};

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

        tx.send("msg1").unwrap();
        tx.send("msg2").unwrap();
        tx.send("msg3").unwrap();

        match rx1.try_recv() {
            Err(broadcast::error::TryRecvError::Lagged(skipped)) => {
                assert_eq!(skipped, 1);
                assert_eq!(rx1.try_recv().unwrap(), "msg2");
            }
            Ok(msg) => panic!("Expected Lagged error, got message: {}", msg),
            Err(e) => panic!("Unexpected error: {:?}", e),
        }

        match rx2.try_recv() {
            Err(broadcast::error::TryRecvError::Lagged(skipped)) => {
                assert_eq!(skipped, 1);
                assert_eq!(rx2.try_recv().unwrap(), "msg2");
            }
            Ok(msg) => panic!("Expected Lagged error, got message: {}", msg),
            Err(e) => panic!("Unexpected error: {:?}", e),
        }

        assert_eq!(rx1.try_recv().unwrap(), "msg3");
        assert_eq!(rx2.try_recv().unwrap(), "msg3");

        assert!(rx1.try_recv().is_err());
        assert!(rx2.try_recv().is_err());
    }

    #[tokio::test]
    async fn test_channel_capacity() {
        let channel = Channel::new("test".to_string(), Some(2));
        let agent_id = "agent1".to_string();
        let tx = channel.join(agent_id.clone()).await;
        let mut rx = tx.subscribe();

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

        ctl.channel_add("room1".into(), None).await;
        ctl.channel_add("room2".into(), None).await;

        ctl.agent_add("user1".into(), None).await;
        ctl.agent_add("user2".into(), None).await;

        let join1 = ctl
            .channel_join("room1", "user1".into(), random_string(8))
            .await;
        assert!(join1.is_ok());
        let join2 = ctl
            .channel_join("room2", "user1".into(), random_string(8))
            .await;
        assert!(join2.is_ok());
        let join3 = ctl
            .channel_join("room1", "user2".into(), random_string(8))
            .await;
        assert!(join3.is_ok());

        let msg = create_test_message("room1", "1", "hello room1");
        let result = ctl.channel_broadcast("room1".into(), msg).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 2); // Both users should receive

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

        let conn_id = "test_conn_id";
        let agent_id = format!("{}:system:1", conn_id);

        ctl.channel_add("system".into(), None).await;
        ctl.conn_add_tx(conn_id.to_string()).await;
        ctl.agent_add(agent_id.clone(), None).await;

        let join = ctl
            .channel_join("system", agent_id.clone(), random_string(8))
            .await;
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

    #[tokio::test]
    async fn test_channel_message_broadcast() {
        let channel = Channel::new("test".to_string(), Some(10));
        let agent_id = "agent1".to_string();

        let tx = channel.join(agent_id.clone()).await;
        let mut rx = tx.subscribe();

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

    #[tokio::test]
    async fn test_channel_error_cases() {
        let ctl = ChannelControl::default();

        let result = ctl
            .channel_join("nonexistent", "user1".into(), random_string(8))
            .await;
        assert!(matches!(result.unwrap_err(), ChannelError::ChannelNotFound));

        ctl.channel_add("room1".into(), None).await;
        let result = ctl
            .channel_join("room1", "user1".into(), random_string(8))
            .await;
        assert!(matches!(
            result.unwrap_err(),
            ChannelError::AgentNotInitiated
        ));

        let result = ctl
            .channel_leave("nonexistent".into(), "user1".into())
            .await;
        assert!(matches!(result.unwrap_err(), ChannelError::ChannelNotFound));
    }

    #[tokio::test]
    async fn test_agent_subscription() {
        let ctl = ChannelControl::default();

        ctl.channel_add("room1".into(), None).await;
        ctl.agent_add("user1".into(), None).await;

        let sub = ctl.agent_rx("user1".into()).await;
        assert!(sub.is_ok());

        ctl.channel_join("room1", "user1".into(), random_string(8))
            .await
            .unwrap();
        let msg = create_test_message("room1", "1", "test");
        let count = ctl.channel_broadcast("room1".into(), msg).await.unwrap();
        assert_eq!(count, 1);

        ctl.agent_rm("user1".into()).await;
        let sub = ctl.agent_rx("user1".into()).await;
        assert!(matches!(sub.unwrap_err(), ChannelError::AgentNotInitiated));
    }

    #[tokio::test]
    async fn test_multiple_agents() {
        let ctl = ChannelControl::default();
        ctl.channel_add("room1".into(), None).await;

        let agent_ids = vec!["agent1", "agent2", "agent3"];
        for agent_id in &agent_ids {
            ctl.agent_add(agent_id.to_string(), None).await;
            let result = ctl
                .channel_join("room1", agent_id.to_string(), random_string(8))
                .await;
            assert!(result.is_ok(), "Agent should join successfully");
        }

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

    #[tokio::test]
    async fn test_message_ordering() {
        let ctl = ChannelControl::default();
        ctl.channel_add("room1".into(), None).await;
        ctl.agent_add("agent1".into(), None).await;

        let _ = ctl
            .channel_join("room1", "agent1".into(), random_string(8))
            .await
            .unwrap();

        let mut rx = ctl.agent_rx("agent1".into()).await.unwrap();

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

    #[tokio::test]
    async fn test_error_handling() {
        let ctl = ChannelControl::default();

        let result = ctl
            .channel_join("nonexistent", "agent1".into(), random_string(8))
            .await;
        assert!(result.is_err());

        let result = ctl
            .channel_leave("nonexistent".into(), "agent1".into())
            .await;
        assert!(result.is_err());

        let msg = create_test_message("nonexistent", "1", "test");
        let result = ctl.channel_broadcast("nonexistent".into(), msg).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_resource_cleanup() {
        let ctl = ChannelControl::default();
        ctl.channel_add("room1".into(), None).await;

        // Add multiple agents and join channel
        for i in 0..5 {
            let agent_id = format!("agent{}", i);
            ctl.agent_add(agent_id.clone(), None).await;
            let _ = ctl
                .channel_join("room1", agent_id.clone(), random_string(8))
                .await;
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
}

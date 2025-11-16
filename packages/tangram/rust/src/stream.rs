use anyhow::{Context, Result};
use futures::StreamExt;
use redis::{AsyncCommands, RedisResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{sync::Mutex, time};
use tracing::{debug, error, info};

use crate::bbox::{is_within_bbox, BoundingBox, BoundingBoxMessage, BoundingBoxState};

pub trait Positioned {
    fn latitude(&self) -> Option<f64>;
    fn longitude(&self) -> Option<f64>;
}

pub trait Tracked {
    fn lastseen(&self) -> u64;
}

pub trait StateCollection {
    type Item: Positioned + Tracked + Clone + Serialize + Send;
    fn get_all(&self) -> Vec<Self::Item>;
    fn history_expire_secs(&self) -> u64;
}

#[derive(Debug, Clone, Serialize)]
struct ResponseData<T> {
    count: usize,
    #[serde(flatten)]
    items: HashMap<String, Vec<T>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClientMessage {
    #[serde(rename = "connectionId")]
    connection_id: String,
    #[serde(flatten)]
    data: HashMap<String, serde_json::Value>,
}

pub async fn start_redis_subscriber(
    redis_url: String,
    state: Arc<Mutex<BoundingBoxState>>,
) -> Result<()> {
    let client = redis::Client::open(redis_url.clone())
        .context("Failed to create Redis client for subscriber")?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.psubscribe("from:system:*").await?;
    pubsub.psubscribe("to:admin:channel.add").await?;

    info!("Redis subscriber started, listening for client events...");

    let mut stream = pubsub.on_message();

    while let Some(msg) = stream.next().await {
        let channel: String = msg.get_channel_name().to_string();
        let payload: String = msg.get_payload()?;

        debug!("Received message: channel={}, payload={}", channel, payload);

        if channel == "from:system:join-streaming" {
            if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&payload) {
                let mut state = state.lock().await;
                state.clients.insert(client_msg.connection_id.clone());
                info!(
                    "+ client joins: {}, {:?}",
                    client_msg.connection_id, state.clients
                );
            }
        } else if channel == "from:system:leave-streaming" {
            if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&payload) {
                let mut state = state.lock().await;
                state.clients.remove(&client_msg.connection_id);
                state.remove_bbox(&client_msg.connection_id);
                info!(
                    "- client leaves: {}, {:?}",
                    client_msg.connection_id, state.clients
                );
            }
        } else if channel == "from:system:bound-box" {
            if let Ok(bbox_msg) = serde_json::from_str::<BoundingBoxMessage>(&payload) {
                let mut state = state.lock().await;
                state.set_bbox(
                    &bbox_msg.connection_id,
                    BoundingBox {
                        north_east_lat: bbox_msg.north_east_lat,
                        north_east_lng: bbox_msg.north_east_lng,
                        south_west_lat: bbox_msg.south_west_lat,
                        south_west_lng: bbox_msg.south_west_lng,
                    },
                );
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
pub struct StreamConfig {
    pub redis_url: String,
    pub stream_interval_secs: f64,
    pub entity_type_name: String,
    pub broadcast_channel_suffix: String,
}

pub async fn stream_statevectors<S>(
    config: StreamConfig,
    bbox_state: Arc<Mutex<BoundingBoxState>>,
    state_vectors: Arc<Mutex<S>>,
) -> Result<()>
where
    S: StateCollection + Send + 'static,
    S::Item: Send,
{
    let redis_client =
        redis::Client::open(config.redis_url.clone()).context("Failed to create Redis client")?;
    let mut redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("Failed to connect to Redis")?;
    loop {
        let clients = {
            let state = bbox_state.lock().await;
            if state.clients.is_empty() {
                time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            state.clients.clone()
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let all_items = {
            let state = state_vectors.lock().await;
            let expire_secs = state.history_expire_secs();
            state
                .get_all()
                .into_iter()
                .filter(|sv| sv.lastseen() > now.saturating_sub(expire_secs))
                .collect::<Vec<_>>()
        };

        for client_id in &clients {
            let filtered_data = {
                let state = bbox_state.lock().await;
                if state.has_bbox(client_id) {
                    all_items
                        .iter()
                        .filter(|a| is_within_bbox(*a, &state, client_id))
                        .cloned()
                        .collect::<Vec<_>>()
                } else {
                    all_items.clone()
                }
            };

            let response = ResponseData {
                count: all_items.len(),
                items: HashMap::from([(config.entity_type_name.clone(), filtered_data)]),
            };

            let channel = format!(
                "to:streaming-{}:{}",
                client_id, config.broadcast_channel_suffix
            );
            match serde_json::to_string(&response) {
                Ok(json) => {
                    let _: RedisResult<()> = redis_conn.publish(&channel, json).await;
                }
                Err(e) => error!("Failed to serialize response: {}", e),
            }
        }

        time::sleep(Duration::from_secs_f64(config.stream_interval_secs)).await;
    }
}

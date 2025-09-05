use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use futures::StreamExt;
use redis::{AsyncCommands, RedisResult};
use serde::{Deserialize, Serialize};
use tokio::{sync::Mutex, time};
use tracing::{debug, error, info};

use crate::{
    bbox::{is_within_bbox, BoundingBox, BoundingBoxMessage, BoundingBoxState},
    state::{Jet1090Message, StateVector, StateVectors},
};

/// Response data to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponseData {
    count: usize,
    aircraft: Vec<StateVector>,
}

// Message from Redis
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClientMessage {
    #[serde(rename = "connectionId")]
    connection_id: String,
    #[serde(flatten)]
    data: HashMap<String, serde_json::Value>,
}

// Start a Redis subscriber to listen for client events
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

        // Handle different message types
        if channel == "from:system:join-streaming" {
            if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&payload) {
                let mut state = state.lock().await;
                state.clients.insert(client_msg.connection_id.clone());
                info!(
                    "+ client joins: {}, {:?}",
                    client_msg.connection_id, state.clients
                );
            } else {
                error!("Failed to parse join message: {}", payload);
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
            } else {
                error!("Failed to parse leave message: {}", payload);
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
            } else {
                error!("Failed to parse bounding box message: {}", payload);
            }
        }
    }

    Ok(())
}

// Start a Redis subscriber to listen for Jet1090 messages
pub async fn start_jet1090_subscriber(
    redis_url: String,
    channel: String,
    state_vectors: Arc<Mutex<StateVectors>>,
) -> Result<()> {
    let client = redis::Client::open(redis_url.clone())
        .context("Failed to create Redis client for Jet1090 subscriber")?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;

    info!(
        "Jet1090 subscriber started, listening for aircraft updates on channel '{}'...",
        channel
    );

    let mut stream = pubsub.on_message();

    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload()?;

        // Skip messages that don't contain DF17, DF18, DF20, or DF21
        if !payload.contains(r#""17""#)
            && !payload.contains(r#""18""#)
            && !payload.contains(r#""20""#)
            && !payload.contains(r#""21""#)
        {
            continue;
        }

        // Parse and process message
        match serde_json::from_str::<Jet1090Message>(&payload) {
            Ok(jet1090_msg) => {
                let mut state = state_vectors.lock().await;
                if let Err(e) = state.add(&jet1090_msg).await {
                    error!("Failed to add aircraft data: {}", e);
                }
            }
            Err(e) => {
                error!(
                    "Failed to parse Jet1090 message: {} - Error: {}",
                    payload, e
                );
            }
        }
    }

    Ok(())
}

pub async fn stream_statevectors(
    redis_url: String,
    bbox_state: Arc<Mutex<BoundingBoxState>>,
    state_vectors: Arc<Mutex<StateVectors>>,
    interval_secs: f64,
) -> Result<()> {
    let redis_client =
        redis::Client::open(redis_url.clone()).context("Failed to create Redis client")?;
    let mut redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("Failed to connect to Redis")?;
    loop {
        // Check if we have any clients
        let clients = {
            let state = bbox_state.lock().await;
            if state.clients.is_empty() {
                time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            state.clients.clone()
        };

        // Get current time to filter out old aircraft
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();

        // Get all aircraft from state vectors
        let all_aircraft = {
            let state = state_vectors.lock().await;
            state
                .aircraft
                .values()
                .filter(|sv| {
                    sv.latitude.is_some() && sv.lastseen > now as u64 - state.history_expire as u64
                })
                .cloned()
                .collect::<Vec<StateVector>>()
        };

        let icao24_set: HashSet<String> = all_aircraft.iter().map(|a| a.icao24.clone()).collect();

        for client_id in &clients {
            // Filter aircraft based on client's bounding box
            let filtered_data = {
                let state = bbox_state.lock().await;
                if state.has_bbox(client_id) {
                    all_aircraft
                        .iter()
                        .filter(|a| is_within_bbox(a, &state, client_id))
                        .cloned()
                        .collect::<Vec<StateVector>>()
                } else {
                    all_aircraft.clone()
                }
            };

            info!(
                "Client {}: filtering, {} {} => {}",
                client_id,
                all_aircraft.len(),
                icao24_set.len(),
                filtered_data.len()
            );

            // Build response data
            let response = ResponseData {
                count: all_aircraft.len(),
                aircraft: filtered_data,
            };

            // Publish to client-specific channel
            let channel = format!("to:streaming-{}:new-data", client_id);
            match serde_json::to_string(&response) {
                Ok(json) => {
                    let _: RedisResult<()> = redis_conn.publish(&channel, json).await;
                    info!(
                        "Published to {} (len: {})",
                        channel,
                        response.aircraft.len()
                    );
                }
                Err(e) => error!("Failed to serialize response: {}", e),
            }
        }

        time::sleep(Duration::from_secs_f64(interval_secs)).await;
    }
}

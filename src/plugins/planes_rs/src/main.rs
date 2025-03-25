use anyhow::{Context, Result};
use clap::Parser;
use futures::StreamExt;
use redis::{AsyncCommands, RedisResult};
use serde::{Deserialize, Serialize};
use std::iter::Iterator;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{sync::Mutex, time};
use tracing::{debug, error, info};
use tracing_subscriber::EnvFilter;

// Command-line arguments
#[derive(Parser, Debug)]
#[clap(author, version, about = "Aircraft data streaming service")]
struct Args {
    /// Redis URL
    #[clap(long, env = "REDIS_URL", default_value = "redis://redis:6379")]
    redis_url: String,

    /// Jet1090 REST service URL
    #[clap(long, env = "JET1090_URL", default_value = "http://jet1090:8080")]
    jet1090_service: String,
}

// Struct for bounding box data
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoundingBox {
    north_east_lat: f64,
    north_east_lng: f64,
    south_west_lat: f64,
    south_west_lng: f64,
}

// Aircraft data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Aircraft {
    icao24: String,
    callsign: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    altitude: Option<f64>,
    track: Option<f64>,
    lastseen: Option<u64>,
    // Add other fields as needed
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

// Message from Redis
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClientMessage {
    #[serde(rename = "connectionId")]
    connection_id: String,
    #[serde(flatten)]
    data: HashMap<String, serde_json::Value>,
}

// Bounding box message
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoundingBoxMessage {
    #[serde(rename = "connectionId")]
    connection_id: String,
    #[serde(rename = "northEastLat")]
    north_east_lat: f64,
    #[serde(rename = "northEastLng")]
    north_east_lng: f64,
    #[serde(rename = "southWestLat")]
    south_west_lat: f64,
    #[serde(rename = "southWestLng")]
    south_west_lng: f64,
}

// Response data to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponseData {
    count: usize,
    aircraft: Vec<Aircraft>,
}

// State to track client connections and their bounding boxes
struct BoundingBoxState {
    bboxes: HashMap<String, BoundingBox>,
    clients: HashSet<String>,
}

impl BoundingBoxState {
    fn new() -> Self {
        Self {
            bboxes: HashMap::new(),
            clients: HashSet::new(),
        }
    }

    fn set_bbox(&mut self, connection_id: &str, bbox: BoundingBox) {
        self.bboxes.insert(connection_id.to_string(), bbox.clone());
        info!(
            "Updated {} bounding box: NE({}, {}), SW({}, {})",
            connection_id, bbox.north_east_lat, bbox.north_east_lng, bbox.south_west_lat, bbox.south_west_lng
        );
    }

    fn has_bbox(&self, connection_id: &str) -> bool {
        self.bboxes.contains_key(connection_id)
    }

    fn get_bbox(&self, connection_id: &str) -> Option<&BoundingBox> {
        self.bboxes.get(connection_id)
    }

    fn remove_bbox(&mut self, connection_id: &str) {
        self.bboxes.remove(connection_id);
    }
}

// Check if an aircraft is within a specific client's bounding box
fn is_within_bbox(aircraft: &Aircraft, state: &BoundingBoxState, connection_id: &str) -> bool {
    // If no bounding box is set for this connection, include all aircraft
    if !state.has_bbox(connection_id) {
        return true;
    }

    let bbox = match state.get_bbox(connection_id) {
        Some(bbox) => bbox,
        None => return true,
    };

    let lat = match aircraft.latitude {
        Some(lat) => lat,
        None => return false,
    };

    let lng = match aircraft.longitude {
        Some(lng) => lng,
        None => return false,
    };

    bbox.south_west_lat <= lat && lat <= bbox.north_east_lat && bbox.south_west_lng <= lng && lng <= bbox.north_east_lng
}

// Start a Redis subscriber to listen for client events
async fn start_redis_subscriber(redis_url: String, state: Arc<Mutex<BoundingBoxState>>) -> Result<()> {
    let client = redis::Client::open(redis_url.clone()).context("Failed to create Redis client for subscriber")?;
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
                info!("+ client joins: {}, {:?}", client_msg.connection_id, state.clients);
            } else {
                error!("Failed to parse join message: {}", payload);
            }
        } else if channel == "from:system:leave-streaming" {
            if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&payload) {
                let mut state = state.lock().await;
                state.clients.remove(&client_msg.connection_id);
                state.remove_bbox(&client_msg.connection_id);
                info!("- client leaves: {}, {:?}", client_msg.connection_id, state.clients);
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

// Main function that fetches aircraft data and publishes filtered data to clients
async fn stream_aircraft_data(jet1090_service: String, redis_url: String, state: Arc<Mutex<BoundingBoxState>>) -> Result<()> {
    let http_client = reqwest::Client::new();
    let all_aircraft_url = format!("{}/all", jet1090_service);
    let redis_client = redis::Client::open(redis_url.clone()).context("Failed to create Redis client")?;
    let mut redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("Failed to connect to Redis")?;

    info!("Streaming aircraft data to WebSocket clients...");

    loop {
        // Check if we have any clients
        let clients = {
            let state = state.lock().await;
            if state.clients.is_empty() {
                time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            state.clients.clone()
        };

        // Fetch aircraft data
        let _now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
        match http_client.get(&all_aircraft_url).send().await {
            Ok(response) => {
                if let Ok(all_aircraft) = response.json::<Vec<Aircraft>>().await {
                    let icao24_set: HashSet<String> = all_aircraft.iter().map(|a| a.icao24.clone()).collect();

                    for client_id in &clients {
                        // Filter aircraft based on client's bounding box
                        let filtered_data = {
                            let state = state.lock().await;
                            if state.has_bbox(client_id) {
                                all_aircraft
                                    .iter()
                                    .filter(|a| is_within_bbox(a, &state, client_id))
                                    .cloned()
                                    .collect::<Vec<Aircraft>>()
                            } else {
                                all_aircraft.clone()
                            }
                        };

                        info!("Client {}: filtering, {} {} => {}", client_id, all_aircraft.len(), icao24_set.len(), filtered_data.len());

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
                                info!("Published to {} (len: {})", channel, response.aircraft.len());
                            }
                            Err(e) => error!("Failed to serialize response: {}", e),
                        }
                    }
                } else {
                    error!("Failed to parse aircraft data response");
                }
            }
            Err(e) => error!("Failed to fetch aircraft data: {}", e),
        }

        time::sleep(Duration::from_secs(1)).await;
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing instead of env_logger
    let file_appender = tracing_appender::rolling::daily("/tmp/tangram", "streaming.log");
    let (_non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Setup the subscriber with both console and file logging
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .with_writer(std::io::stdout)
        .init();

    // For file logging (uncomment if needed)
    // tracing_subscriber::fmt()
    //    .with_writer(non_blocking)
    //    .init();

    info!("Logging initialized with tracing");

    // Parse command line arguments
    let args = Args::parse();

    // Create shared state
    let state = Arc::new(Mutex::new(BoundingBoxState::new()));

    // Clone state and URLs for the subscriber task
    let subscriber_state = Arc::clone(&state);
    let redis_url_clone = args.redis_url.clone();

    // Spawn Redis subscriber task
    let subscriber_handle = tokio::spawn(async move {
        match start_redis_subscriber(redis_url_clone, subscriber_state).await {
            Ok(_) => info!("Redis subscriber stopped normally"),
            Err(e) => error!("Redis subscriber error: {}", e),
        }
    });

    // Start main streaming task
    let streaming_handle = tokio::spawn(async move {
        match stream_aircraft_data(args.jet1090_service, args.redis_url, state).await {
            Ok(_) => info!("Streaming task stopped normally"),
            Err(e) => error!("Streaming task error: {}", e),
        }
    });

    // Wait for both tasks
    tokio::select! {
        _ = subscriber_handle => {
            error!("Redis subscriber task exited unexpectedly");
        }
        _ = streaming_handle => {
            error!("Streaming task exited unexpectedly");
        }
    }

    Ok(())
}

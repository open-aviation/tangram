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
use rs1090;

// Command-line arguments
#[derive(Parser, Debug)]
#[clap(author, version, about = "Aircraft data streaming service")]
struct Args {
    /// Redis URL
    #[clap(long, env = "REDIS_URL", default_value = "redis://redis:6379")]
    redis_url: String,

    /// Redis channel for Jet1090 messages
    #[clap(long, env = "JET1090_CHANNEL", default_value = "jet1090")]
    jet1090_channel: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StateVector {
    icao24: String,
    registration: Option<String>,
    typecode: Option<String>,
    lastseen: f64,
    firstseen: f64,
    callsign: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    altitude: Option<f64>,
    track: Option<f64>,
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

/// Jet1090 message format
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Jet1090Message {
    icao24: String,
    df: String,
    bds: Option<String>,
    timestamp: f64,
    callsign: Option<String>,
    altitude: Option<f64>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    track: Option<f64>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

/// Response data to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponseData {
    count: usize,
    aircraft: Vec<StateVector>,
}

/// State vectors collection to track aircraft
#[derive(Debug)]
struct StateVectors {
    aircraft: HashMap<String, StateVector>,
    aircraft_db: HashMap<String, serde_json::Value>,
}

impl StateVectors {
    fn new() -> Self {
        Self {
            aircraft: HashMap::new(),
            aircraft_db: HashMap::new(),
        }
    }

    fn add(&mut self, msg: &Jet1090Message) -> Result<()> {
        // Skip messages that don't match criteria
        if msg.df != "17" && msg.df != "18" {
            return Ok(());
        }

        if let Some(bds) = &msg.bds {
            if !["05", "06", "08", "09"].contains(&bds.as_str()) {
                return Ok(());
            }
        } else {
            return Ok(());
        }

        // Get or create state vector
        let sv = self.aircraft.entry(msg.icao24.clone()).or_insert_with(|| {
            let registration = match rs1090::data::patterns::aircraft_information(&msg.icao24, None) {
                Ok(aircraft_info) => aircraft_info.registration.clone(),
                Err(_) => None,
            };

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64();

            // Try to get typecode from aircraft_db (would need to be implemented properly)
            let typecode = self.aircraft_db.get(&msg.icao24)
                .and_then(|data| data.get("typecode"))
                .and_then(|v| v.as_str())
                .map(String::from);

            StateVector {
                icao24: msg.icao24.clone(),
                registration,
                typecode,
                lastseen: now,
                firstseen: now,
                callsign: None,
                latitude: None,
                longitude: None,
                altitude: None,
                track: None,
            }
        });

        // Update state vector with new information
        sv.lastseen = msg.timestamp;
        if msg.df == "18" {
            sv.typecode = Some("GRND".to_string());
        }
        if let Some(callsign) = &msg.callsign {
            sv.callsign = Some(callsign.clone());
        }
        if let Some(altitude) = msg.altitude {
            sv.altitude = Some(altitude);
        }
        if let Some(latitude) = msg.latitude {
            sv.latitude = Some(latitude);
        }
        if let Some(longitude) = msg.longitude {
            sv.longitude = Some(longitude);
        }
        if let Some(track) = msg.track {
            sv.track = Some(track);
        }
        Ok(())
    }
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
fn is_within_bbox(aircraft: &StateVector, state: &BoundingBoxState, connection_id: &str) -> bool {
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

// Start a Redis subscriber to listen for Jet1090 messages
async fn start_jet1090_subscriber(redis_url: String, channel: String, state_vectors: Arc<Mutex<StateVectors>>) -> Result<()> {
    let client = redis::Client::open(redis_url.clone()).context("Failed to create Redis client for Jet1090 subscriber")?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;

    info!("Jet1090 subscriber started, listening for aircraft updates on channel '{}'...", channel);

    let mut stream = pubsub.on_message();

    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload()?;

        // Skip messages that don't contain DF17 or DF18
        if !payload.contains("\"17\"") && !payload.contains("\"18\"") {
            continue;
        }

        // Parse and process message
        match serde_json::from_str::<Jet1090Message>(&payload) {
            Ok(jet1090_msg) => {
                let mut state = state_vectors.lock().await;
                if let Err(e) = state.add(&jet1090_msg) {
                    error!("Failed to add aircraft data: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to parse Jet1090 message: {} - Error: {}", payload, e);
            }
        }
    }

    Ok(())
}

async fn stream_aircraft_data(
    redis_url: String,
    bbox_state: Arc<Mutex<BoundingBoxState>>,
    state_vectors: Arc<Mutex<StateVectors>>
) -> Result<()> {
    let redis_client = redis::Client::open(redis_url.clone()).context("Failed to create Redis client")?;
    let mut redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("Failed to connect to Redis")?;
    info!("Streaming aircraft data to WebSocket clients...");
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
            state.aircraft
                .values()
                .filter(|sv| {
                    sv.latitude.is_some() && sv.lastseen > now - 600.0 // Filter out aircraft older than 10 minutes (600 seconds)
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

    // Parse command line arguments
    let args = Args::parse();

    // Spawn Redis subscribers
    let redis_url_clone = args.redis_url.clone();
    let bbox_state = Arc::new(Mutex::new(BoundingBoxState::new()));
    let bbox_subscriber_state = Arc::clone(&bbox_state);
    let bbox_subscriber_handle = tokio::spawn(async move {
        match start_redis_subscriber(redis_url_clone, bbox_subscriber_state).await {
            Ok(_) => info!("BoundingBox subscriber stopped normally"),
            Err(e) => error!("BoundingBox subscriber error: {}", e),
        }
    });

    let redis_url_clone2 = args.redis_url.clone();
    let jet1090_channel = args.jet1090_channel.clone();
    let state_vectors = Arc::new(Mutex::new(StateVectors::new()));
    let jet1090_subscriber_state = Arc::clone(&state_vectors);
    let jet1090_subscriber_handle = tokio::spawn(async move {
        match start_jet1090_subscriber(redis_url_clone2, jet1090_channel, jet1090_subscriber_state).await {
            Ok(_) => info!("Jet1090 subscriber stopped normally"),
            Err(e) => error!("Jet1090 subscriber error: {}", e),
        }
    });

    // Start main streaming task
    let streaming_handle = tokio::spawn(async move {
        match stream_aircraft_data(args.redis_url, bbox_state, state_vectors).await {
            Ok(_) => info!("Streaming task stopped normally"),
            Err(e) => error!("Streaming task error: {}", e),
        }
    });

    // Wait for tasks to complete
    tokio::select! {
        _ = bbox_subscriber_handle => {
            error!("BoundingBox subscriber task exited unexpectedly");
        }
        _ = jet1090_subscriber_handle => {
            error!("Jet1090 subscriber task exited unexpectedly");
        }
        _ = streaming_handle => {
            error!("Streaming task exited unexpectedly");
        }
    }

    Ok(())
}

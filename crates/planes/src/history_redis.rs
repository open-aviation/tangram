mod aircraftdb;

use anyhow::{Context, Result};
use clap::Parser;
use futures::StreamExt;
use redis::{AsyncCommands, RedisResult};
use rs1090::data::patterns::aircraft_information;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
use tracing::{debug, error, info};
use tracing_subscriber::EnvFilter;

use crate::aircraftdb::{aircraft, Aircraft};

// Command-line arguments
#[derive(Parser, Debug)]
#[clap(author, version, about = "Aircraft history recording service using Redis")]
struct Args {
    /// Redis URL
    #[clap(long, env = "REDIS_URL", default_value = "redis://redis:6379")]
    redis_url: String,

    /// Redis channel for Jet1090 messages
    #[clap(long, env = "JET1090_CHANNEL", default_value = "jet1090")]
    jet1090_channel: String,

    /// Aggregation interval in seconds
    #[clap(long, env = "AGGREGATION_INTERVAL", default_value = "60")]
    aggregation_interval: u64,

    /// History data expiry time in seconds (default: 10 minutes)
    #[clap(long, env = "HISTORY_EXPIRY", default_value = "600")]
    history_expiry: u64,
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

/// Redis-based state vectors collection
#[derive(Debug)]
struct RedisStateVectors {
    aircraft_db: BTreeMap<String, Aircraft>,
    redis_client: redis::Client,
    aggregation_interval: u64,        // Aggregation interval in seconds
    history_expiry: u64,              // History data expiry in seconds
}

impl RedisStateVectors {
    async fn new(redis_url: &str, aggregation_interval: u64, history_expiry: u64) -> Result<Self> {
        let redis_client = redis::Client::open(redis_url)
            .context("Failed to create Redis client for state vectors")?;

        let mut conn = redis_client.get_multiplexed_async_connection().await?;
        let _: RedisResult<String> = conn.ping().await;

        info!("Using data aggregation interval of {} seconds", aggregation_interval);
        info!("History data will expire after {} seconds", history_expiry);

        Ok(Self {
            aircraft_db: aircraft().await,
            redis_client,
            aggregation_interval,
            history_expiry,
        })
    }

    async fn get_aircraft(&self, icao24: &str) -> Result<Option<StateVector>> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("aircraft:current:{}", icao24);
        let data: Option<String> = conn.get(&key).await?;
        if data.is_none() {
            return Ok(None)
        }
        match serde_json::from_str::<StateVector>(&data.unwrap()) {
            Ok(sv) => Ok(Some(sv)),
            Err(e) => {
                error!("Failed to deserialize aircraft data: {}", e);
                Ok(None)
            }
        }
    }

    async fn save_aircraft(&self, sv: &StateVector) -> Result<()> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("aircraft:current:{}", sv.icao24);
        let data = serde_json::to_string(sv)?;
        conn.set::<_, _, ()>(&key, &data).await?;
        conn.expire::<_, ()>(&key, 3600).await?;
        Ok(())
    }

    async fn get_last_write_time(&self, icao24: &str) -> Result<f64> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("aircraft:lastwrite:{}", icao24);
        let data: Option<String> = conn.get(&key).await?;
        if data.is_none() {
            return Ok(0.0)
        }
        match data.unwrap().parse::<f64>() {
            Ok(ts) => Ok(ts),
            Err(e) => {
                error!("Failed to parse last write time: {}", e);
                Ok(0.0)
            }
        }
    }

    async fn set_last_write_time(&self, icao24: &str, timestamp: f64) -> Result<()> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("aircraft:lastwrite:{}", icao24);
        conn.set::<_, _, ()>(&key, timestamp.to_string()).await?; // store last write time in Redis
        conn.expire::<_, ()>(&key, 3600).await?; // set expiry to match aircraft data
        Ok(())
    }

    async fn add(&mut self, msg: &Jet1090Message) -> Result<()> {
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
        let mut sv = match self.get_aircraft(&msg.icao24).await? {
            Some(sv) => sv,
            None => {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64();

                // Look up aircraft information
                let mut registration = match aircraft_information(&msg.icao24, None) {
                    Ok(aircraft_info) => aircraft_info.registration.clone(),
                    Err(_) => None,
                };

                let mut typecode = None;

                if let Some(aircraft) = self.aircraft_db.get(&msg.icao24) {
                    typecode = aircraft.typecode.clone();
                    registration = aircraft.registration.clone();
                }

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
            }
        };

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

        self.save_aircraft(&sv).await?; // save updated state vector
        self.maybe_write_to_redis(&msg.icao24, &sv).await?; // check if we should write history based on aggregation interval
        Ok(())
    }

    async fn maybe_write_to_redis(&self, icao24: &str, sv: &StateVector) -> Result<()> {
        // Only write to Redis if aircraft has position data
        if sv.latitude.is_none() || sv.longitude.is_none() {
            return Ok(());
        }

        let last_write_time = self.get_last_write_time(icao24).await?;
        let interval_secs = self.aggregation_interval as f64;

        // If enough time has passed since last write
        if sv.lastseen - last_write_time >= interval_secs {
            self.store_in_redis(sv).await?;
            self.set_last_write_time(icao24, sv.lastseen).await?;
            debug!("Stored history for {} at {}", sv.icao24, sv.lastseen);
        }

        Ok(())
    }

    async fn store_in_redis(&self, sv: &StateVector) -> Result<()> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        // Create a history entry as JSON
        let history_entry = serde_json::json!({
            "icao24": sv.icao24,
            "registration": sv.registration,
            "typecode": sv.typecode,
            "callsign": sv.callsign,
            "latitude": sv.latitude,
            "longitude": sv.longitude,
            "altitude": sv.altitude,
            "track": sv.track,
            "timestamp": sv.lastseen,
        });

        // Convert to JSON string
        let entry_json = serde_json::to_string(&history_entry)?;

        // Create a Redis key for this entry using timestamp for ordering - with explicit type annotations
        let history_key = format!("aircraft:history:{}:{}", sv.icao24, sv.lastseen);
        conn.set::<_, _, ()>(&history_key, &entry_json).await?;
        conn.expire::<_, ()>(&history_key, self.history_expiry.try_into().unwrap()).await?;

        // Add to a sorted set for efficient time-based querying - with explicit type annotations
        let timeline_key = format!("aircraft:timeline:{}", sv.icao24);
        conn.zadd::<_, _, _, ()>(&timeline_key, sv.lastseen.to_string(), sv.lastseen).await?;
        conn.expire::<_, ()>(&timeline_key, self.history_expiry.try_into().unwrap()).await?;

        Ok(())
    }
}

// Start a Redis subscriber to listen for Jet1090 messages
async fn start_jet1090_subscriber(
    redis_url: String,
    channel: String,
    state_vectors: Arc<Mutex<RedisStateVectors>>,
) -> Result<()> {
    let client = redis::Client::open(redis_url.clone())
        .context("Failed to create Redis client for Jet1090 subscriber")?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;

    info!("listening for aircraft updates on channel '{}'...", channel);
    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload()?;

        if !payload.contains(r#""17""#) && !payload.contains(r#""18""#) {
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
                error!("Failed to parse Jet1090 message: {} - Error: {}", payload, e);
            }
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables from a .env file
    dotenv::dotenv().ok();

    // Initialize tracing instead of env_logger
    let file_appender = tracing_appender::rolling::daily("/tmp/tangram", "history_redis.log");
    let (_non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Setup the subscriber with both console and file logging
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .with_writer(std::io::stdout)
        .init();

    // Parse command line arguments
    let args = Args::parse();

    // Initialize Redis state vectors
    let state_vectors = Arc::new(Mutex::new(
        RedisStateVectors::new(&args.redis_url, args.aggregation_interval, args.history_expiry).await?
    ));

    // Start the Jet1090 subscriber
    info!("Starting aircraft history recorder with Redis...");
    info!("Using Redis at: {}", args.redis_url);
    info!("Using aggregation interval of {} seconds", args.aggregation_interval);
    info!("History data will expire after {} seconds", args.history_expiry);

    // Run the Jet1090 subscriber and wait for it to complete
    match start_jet1090_subscriber(args.redis_url,args.jet1090_channel,state_vectors).await {
        Ok(_) => info!("Jet1090 subscriber stopped normally"),
        Err(e) => error!("Jet1090 subscriber error: {}", e),
    }

    Ok(())
}

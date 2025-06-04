mod aircraftdb;

use anyhow::{Context, Result};
use clap::Parser;
use futures::StreamExt;
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
use rusqlite::{params, Connection};
use tokio::fs;
use std::path::Path;

use crate::aircraftdb::{aircraft, Aircraft};

// Command-line arguments
#[derive(Parser, Debug)]
#[clap(author, version, about = "Aircraft data recording service")]
struct Args {
    /// Redis URL
    #[clap(long, env = "REDIS_URL", default_value = "redis://redis:6379")]
    redis_url: String,

    /// Redis channel for Jet1090 messages
    #[clap(long, env = "JET1090_CHANNEL", default_value = "jet1090")]
    jet1090_channel: String,

    /// Expire aircraft after (in seconds)
    #[clap(long, env = "EXPIRE_AIRCRAFT", default_value = None)]
    expire: Option<u16>,

    /// SQLite database path
    #[clap(long, env = "DB_PATH", default_value = "aircraft_history.db")]
    db_path: String,

    /// Aggregation interval in seconds
    #[clap(long, env = "AGGREGATION_INTERVAL", default_value = "1")]
    aggregation_interval: u64,
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

/// State vectors collection to track aircraft
#[derive(Debug)]
struct StateVectors {
    aircraft: HashMap<String, StateVector>,
    aircraft_db: BTreeMap<String, Aircraft>,
    // expire: Option<u16>,
    sqlite_conn: Arc<Mutex<Connection>>,
    last_write: HashMap<String, f64>, // Track last write time per aircraft
    aggregation_interval: u64, // Aggregation interval in seconds
}

impl StateVectors {
    async fn new(_expire: Option<u16>, db_path: &str, aggregation_interval: u64) -> Result<Self> {
        // Ensure directory exists
        if let Some(parent) = Path::new(db_path).parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await?;
            }
        }

        // Open SQLite connection
        let conn = Connection::open(db_path)?;

        // Create tables if they don't exist
        conn.execute(
            "CREATE TABLE IF NOT EXISTS aircraft_history (
                id INTEGER PRIMARY KEY,
                icao24 TEXT NOT NULL,
                registration TEXT,
                typecode TEXT,
                callsign TEXT,
                latitude REAL,
                longitude REAL,
                altitude REAL,
                track REAL,
                timestamp REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Create index on icao24 and timestamp
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_aircraft_icao_time ON aircraft_history (icao24, timestamp)",
            [],
        )?;

        info!("Using data aggregation interval of {} seconds", aggregation_interval);

        Ok(Self {
            aircraft: HashMap::new(),
            aircraft_db: aircraft().await,
            // expire,
            sqlite_conn: Arc::new(Mutex::new(conn)),
            last_write: HashMap::new(),
            aggregation_interval,
        })
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
        let sv = self.aircraft.entry(msg.icao24.clone()).or_insert_with(|| {
            let mut registration = match aircraft_information(&msg.icao24, None) {
                Ok(aircraft_info) => aircraft_info.registration.clone(),
                Err(_) => None,
            };

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64();

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

        // Check if we should write to SQLite based on aggregation interval
        self.maybe_write_to_sqlite(&msg.icao24).await?;

        Ok(())
    }

    async fn maybe_write_to_sqlite(&mut self, icao24: &str) -> Result<()> {
        if let Some(sv) = self.aircraft.get(icao24) {
            let current_time = sv.lastseen;

            // Only write if we have position data
            if sv.latitude.is_none() || sv.longitude.is_none() {
                return Ok(());
            }

            let last_write = self.last_write.get(icao24).copied().unwrap_or(0.0);
            let interval_secs = self.aggregation_interval as f64;

            // If enough time has passed since last write or this is the first write
            if current_time - last_write >= interval_secs {
                self.store_in_sqlite(sv).await?;
                self.last_write.insert(icao24.to_string(), current_time);
                debug!("Wrote aggregated data for aircraft {}", icao24);
            }
        }

        Ok(())
    }

    async fn store_in_sqlite(&self, sv: &StateVector) -> Result<()> {
        let conn = self.sqlite_conn.lock().await;

        conn.execute(
            "INSERT INTO aircraft_history
            (icao24, registration, typecode, callsign, latitude, longitude, altitude, track, timestamp)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                sv.icao24,
                sv.registration,
                sv.typecode,
                sv.callsign,
                sv.latitude,
                sv.longitude,
                sv.altitude,
                sv.track,
                sv.lastseen
            ],
        )?;

        Ok(())
    }
}

// Start a Redis subscriber to listen for Jet1090 messages
async fn start_jet1090_subscriber(
    redis_url: String, channel: String, state_vectors: Arc<Mutex<StateVectors>>,
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

        // Skip messages that don't contain DF17 or DF18
        if !payload.contains("\"17\"") && !payload.contains("\"18\"") {
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
    let file_appender =
        tracing_appender::rolling::daily("/tmp/tangram", "history.log");
    let (_non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Setup the subscriber with both console and file logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("info".parse().unwrap()),
        )
        .with_writer(std::io::stdout)
        .init();

    // Parse command line arguments
    let args = Args::parse();

    // Initialize state vectors with SQLite connection
    let expire = args.expire;
    let state_vectors = Arc::new(Mutex::new(
        StateVectors::new(expire, &args.db_path, args.aggregation_interval).await?
    ));

    // Start the Jet1090 subscriber
    info!("Starting aircraft history recorder...");
    info!("Data will be stored in SQLite database: {}", args.db_path);
    info!("Using aggregation interval of {} seconds", args.aggregation_interval);

    // Run the Jet1090 subscriber and wait for it to complete
    match start_jet1090_subscriber(
        args.redis_url,
        args.jet1090_channel,
        state_vectors,
    ).await {
        Ok(_) => info!("Jet1090 subscriber stopped normally"),
        Err(e) => error!("Jet1090 subscriber error: {}", e),
    }

    Ok(())
}

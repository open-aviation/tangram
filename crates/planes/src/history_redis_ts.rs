mod aircraftdb;

use std::collections::{BTreeMap, HashMap};
use std::io;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{
        disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
    },
};
use futures::StreamExt;
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::Span, // Removed Text import
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
    Terminal,
};
use redis::{AsyncCommands, RedisResult};
use rs1090::data::patterns::aircraft_information;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, error, info};
use tracing_subscriber::EnvFilter;

use crate::aircraftdb::{aircraft, Aircraft};

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

/// State Vector representing an aircraft position and state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateVector {
    pub icao24: String,
    pub registration: Option<String>,
    pub typecode: Option<String>,
    pub lastseen: f64,
    pub firstseen: f64,
    pub callsign: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude: Option<f64>,
    pub track: Option<f64>,
}

/// Redis-based state vectors collection with Time Series support
#[derive(Debug)]
struct RedisTimeSeriesState {
    aircraft_db: BTreeMap<String, Aircraft>,
    redis_client: redis::Client,
    aggregation_interval: u64, // Aggregation interval in seconds
    retention_msecs: i64,      // Retention period in milliseconds
    lastwrite_expiry: u64,     // TTL for lastwrite keys
}

impl RedisTimeSeriesState {
    async fn new(
        redis_url: &str, aggregation_interval: u64, history_expiry: u64,
    ) -> Result<Self> {
        let redis_client = redis::Client::open(redis_url)
            .context("Failed to create Redis client for time series state")?;

        let mut conn = redis_client.get_multiplexed_async_connection().await?;
        let _: RedisResult<String> = conn.ping().await;

        info!("Using data aggregation interval of {} seconds", aggregation_interval);
        info!("History data will expire after {} seconds", history_expiry);

        Ok(Self {
            aircraft_db: aircraft().await,
            redis_client,
            aggregation_interval,
            retention_msecs: (history_expiry as i64) * 1000,
            lastwrite_expiry: 600, // 10 minutes TTL for lastwrite keys
        })
    }

    async fn get_aircraft(&self, icao24: &str) -> Result<Option<StateVector>> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("aircraft:current:{}", icao24);
        let data: Option<String> = conn.get(&key).await?;
        if data.is_none() {
            return Ok(None);
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

        // First check if the aircraft already exists
        let existing_data: Option<String> = conn.get(&key).await?;
        let merged_sv = if let Some(existing) = existing_data {
            match serde_json::from_str::<StateVector>(&existing) {
                Ok(mut existing_sv) => {
                    // Only update fields that have values in the new state vector
                    if sv.registration.is_some() {
                        existing_sv.registration = sv.registration.clone();
                    }
                    if sv.typecode.is_some() {
                        existing_sv.typecode = sv.typecode.clone();
                    }
                    if sv.callsign.is_some() {
                        existing_sv.callsign = sv.callsign.clone();
                    }
                    if sv.latitude.is_some() {
                        existing_sv.latitude = sv.latitude;
                    }
                    if sv.longitude.is_some() {
                        existing_sv.longitude = sv.longitude;
                    }
                    if sv.altitude.is_some() {
                        existing_sv.altitude = sv.altitude;
                    }
                    if sv.track.is_some() {
                        existing_sv.track = sv.track;
                    }

                    // Always update lastseen if the new timestamp is more recent
                    if sv.lastseen > existing_sv.lastseen {
                        existing_sv.lastseen = sv.lastseen;
                    }

                    existing_sv
                },
                Err(_) => sv.clone(), // If we can't parse existing data, use the new data
            }
        } else {
            sv.clone()  // If no existing data, just use the new state vector
        };

        let data = serde_json::to_string(&merged_sv)?;
        conn.set::<_, _, ()>(&key, &data).await?;
        conn.expire::<_, ()>(&key, self.lastwrite_expiry.try_into().unwrap()).await?;
        debug!("Saved aircraft data for {}, lastseen: {}", merged_sv.icao24, merged_sv.lastseen);
        Ok(())
    }

    async fn get_last_write_time(&self, icao24: &str) -> Result<f64> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("aircraft:lastwrite:{}", icao24);
        let data: Option<String> = conn.get(&key).await?;
        if data.is_none() {
            return Ok(0.0);
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
        conn.set::<_, _, ()>(&key, timestamp.to_string()).await?;
        conn.expire::<_, ()>(&key, self.lastwrite_expiry.try_into().unwrap())
            .await?;
        Ok(())
    }

    async fn ensure_timeseries_exists(
        &self, key: &str, labels: HashMap<String, String>,
    ) -> Result<bool> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        // Check if the time series exists
        let exists: bool = redis::cmd("TS.INFO")
            .arg(key)
            .query_async(&mut conn)
            .await
            .map(|_: ()| true)
            .unwrap_or(false);

        if exists {
            return Ok(true);
        }

        // Create the time series if it doesn't exist
        let mut cmd = redis::cmd("TS.CREATE");
        cmd.arg(key);
        cmd.arg("RETENTION").arg(self.retention_msecs);

        // Add labels
        if !labels.is_empty() {
            cmd.arg("LABELS");
            for (k, v) in &labels {
                cmd.arg(k).arg(v);
            }
        }

        match cmd.query_async::<()>(&mut conn).await {
            Ok(_) => {
                debug!("Created time series {}", key);
                Ok(true)
            }
            Err(e) => {
                error!("Failed to create time series {}: {}", key, e);
                Ok(false)
            }
        }
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

        // Update state vector with new information - only update lastseen if message timestamp is more recent
        if msg.timestamp > sv.lastseen {
            sv.lastseen = msg.timestamp;
        }
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
        self.save_history(&sv).await?; // save to time series
        Ok(())
    }

    async fn save_history(&self, sv: &StateVector) -> Result<()> {
        // Check if we should record history based on write interval
        let last_write_time = self.get_last_write_time(&sv.icao24).await?;
        let interval_secs = self.aggregation_interval as f64;

        if sv.lastseen - last_write_time < interval_secs {
            return Ok(());
        }

        // Skip if no position data
        if sv.latitude.is_none() || sv.longitude.is_none() {
            return Ok(());
        }

        let timestamp_ms = (sv.lastseen * 1000.0) as i64; // Convert to milliseconds
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        // Common labels for all time series for this aircraft
        let mut common_labels = HashMap::new();
        common_labels.insert("icao24".to_string(), sv.icao24.clone());
        if let Some(ref registration) = sv.registration {
            if !registration.is_empty() {
                common_labels.insert("registration".to_string(), registration.clone());
            }
        }
        if let Some(ref typecode) = sv.typecode {
            if !typecode.is_empty() {
                common_labels.insert("typecode".to_string(), typecode.clone());
            }
        }
        if let Some(ref callsign) = sv.callsign {
            if !callsign.is_empty() {
                common_labels.insert("callsign".to_string(), callsign.clone());
            }
        }

        // Add position data to time series
        if let Some(latitude) = sv.latitude {
            let lat_key = format!("aircraft:ts:latitude:{}", sv.icao24);
            let mut lat_labels = common_labels.clone();
            lat_labels.insert("type".to_string(), "latitude".to_string());

            if self.ensure_timeseries_exists(&lat_key, lat_labels).await? {
                let _: RedisResult<()> = redis::cmd("TS.ADD")
                    .arg(&lat_key)
                    .arg(timestamp_ms)
                    .arg(latitude)
                    .query_async(&mut conn)
                    .await;
            }
        }

        if let Some(longitude) = sv.longitude {
            let lon_key = format!("aircraft:ts:longitude:{}", sv.icao24);
            let mut lon_labels = common_labels.clone();
            lon_labels.insert("type".to_string(), "longitude".to_string());

            if self.ensure_timeseries_exists(&lon_key, lon_labels).await? {
                let _: RedisResult<()> = redis::cmd("TS.ADD")
                    .arg(&lon_key)
                    .arg(timestamp_ms)
                    .arg(longitude)
                    .query_async(&mut conn)
                    .await;
            }
        }

        if let Some(altitude) = sv.altitude {
            let alt_key = format!("aircraft:ts:altitude:{}", sv.icao24);
            let mut alt_labels = common_labels.clone();
            alt_labels.insert("type".to_string(), "altitude".to_string());

            if self.ensure_timeseries_exists(&alt_key, alt_labels).await? {
                let _: RedisResult<()> = redis::cmd("TS.ADD")
                    .arg(&alt_key)
                    .arg(timestamp_ms)
                    .arg(altitude)
                    .query_async(&mut conn)
                    .await;
            }
        }

        if let Some(track) = sv.track {
            let track_key = format!("aircraft:ts:track:{}", sv.icao24);
            let mut track_labels = common_labels.clone();
            track_labels.insert("type".to_string(), "track".to_string());

            if self
                .ensure_timeseries_exists(&track_key, track_labels)
                .await?
            {
                let _: RedisResult<()> = redis::cmd("TS.ADD")
                    .arg(&track_key)
                    .arg(timestamp_ms)
                    .arg(track)
                    .query_async(&mut conn)
                    .await;
            }
        }

        // Update last write timestamp
        self.set_last_write_time(&sv.icao24, sv.lastseen).await?;
        debug!("Stored history for {} at {} using Time Series", sv.icao24, sv.lastseen);
        Ok(())
    }
}

/// Client for interacting with aircraft state and history data
pub struct StateClient {
    redis_client: redis::Client,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackPoint {
    pub timestamp: f64,
    pub icao24: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude: Option<f64>,
    pub track: Option<f64>,
    pub registration: Option<String>,
    pub typecode: Option<String>,
    pub callsign: Option<String>,
}

impl StateClient {
    pub async fn new(redis_url: Option<String>) -> Result<Self> {
        let url = redis_url.unwrap_or_else(|| {
            std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://redis:6379".to_string())
        });

        let redis_client = redis::Client::open(url)?;
        let mut conn = redis_client.get_multiplexed_async_connection().await?;
        let _: RedisResult<String> = conn.ping().await;

        Ok(Self { redis_client })
    }

    pub async fn get_aircraft_table(&self) -> Result<HashMap<String, StateVector>> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let aircraft_keys: Vec<String> = conn.keys("aircraft:current:*").await?;

        let mut result = HashMap::new();
        for key in aircraft_keys {
            let icao24 = key.split(':').last().unwrap_or_default().to_string();
            let data: Option<String> = conn.get(&key).await?;

            if let Some(data) = data {
                match serde_json::from_str::<StateVector>(&data) {
                    Ok(aircraft_info) => {
                        result.insert(icao24, aircraft_info);
                    }
                    Err(e) => {
                        error!("Failed to parse aircraft data for {}: {}", key, e);
                    }
                }
            }
        }

        Ok(result)
    }

    pub async fn get_aircraft(&self, icao24: &str) -> Result<Option<StateVector>> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let key = format!("aircraft:current:{}", icao24);
        let data: Option<String> = conn.get(&key).await?;

        if let Some(data) = data {
            match serde_json::from_str::<StateVector>(&data) {
                Ok(sv) => Ok(Some(sv)),
                Err(e) => {
                    error!("Failed to parse aircraft data: {}", e);
                    Ok(None)
                }
            }
        } else {
            Ok(None)
        }
    }

    pub async fn get_aircraft_track(
        &self, icao24: &str, start_ts: Option<f64>, end_ts: Option<f64>,
        limit: Option<usize>,
    ) -> Result<Vec<TrackPoint>> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let limit_val = limit.unwrap_or(100);

        // Instead of using BTreeMap with f64 keys, use a HashMap with i64 keys (millisecond timestamps)
        // and later convert back to f64 for the final result
        let mut results = std::collections::HashMap::new();

        let lat_key = format!("aircraft:ts:latitude:{}", icao24);
        let lon_key = format!("aircraft:ts:longitude:{}", icao24);
        let alt_key = format!("aircraft:ts:altitude:{}", icao24);
        let track_key = format!("aircraft:ts:track:{}", icao24);

        // Create the Redis commands properly to avoid temporary value issues
        let mut lat_cmd = redis::cmd("TS.RANGE");
        lat_cmd.arg(&lat_key);

        let mut lon_cmd = redis::cmd("TS.RANGE");
        lon_cmd.arg(&lon_key);

        let mut alt_cmd = redis::cmd("TS.RANGE");
        alt_cmd.arg(&alt_key);

        let mut track_cmd = redis::cmd("TS.RANGE");
        track_cmd.arg(&track_key);

        // Add range parameters
        if let Some(ts) = start_ts {
            let from_time = (ts * 1000.0) as i64;
            lat_cmd.arg(from_time);
            lon_cmd.arg(from_time);
            alt_cmd.arg(from_time);
            track_cmd.arg(from_time);
        } else {
            lat_cmd.arg("-");
            lon_cmd.arg("-");
            alt_cmd.arg("-");
            track_cmd.arg("-");
        }

        if let Some(ts) = end_ts {
            let to_time = (ts * 1000.0) as i64;
            lat_cmd.arg(to_time);
            lon_cmd.arg(to_time);
            alt_cmd.arg(to_time);
            track_cmd.arg(to_time);
        } else {
            lat_cmd.arg("+");
            lon_cmd.arg("+");
            alt_cmd.arg("+");
            track_cmd.arg("+");
        }

        // Add count parameter
        lat_cmd.arg("COUNT").arg(limit_val);
        lon_cmd.arg("COUNT").arg(limit_val);
        alt_cmd.arg("COUNT").arg(limit_val);
        track_cmd.arg("COUNT").arg(limit_val);

        // Execute commands
        let lat_data_result: Result<Vec<(i64, f64)>> = lat_cmd
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get latitude data: {}", e));

        let lon_data_result: Result<Vec<(i64, f64)>> = lon_cmd
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get longitude data: {}", e));

        let alt_data_result: Result<Vec<(i64, f64)>> = alt_cmd
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get altitude data: {}", e));

        let track_data_result: Result<Vec<(i64, f64)>> = track_cmd
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get track data: {}", e));

        // Process latitude data
        if let Ok(lat_data) = lat_data_result {
            for (timestamp, value) in lat_data {
                let ts_sec = timestamp as f64 / 1000.0;
                results
                    .entry(timestamp)
                    .or_insert_with(|| TrackPoint {
                        timestamp: ts_sec,
                        icao24: icao24.to_string(),
                        latitude: None,
                        longitude: None,
                        altitude: None,
                        track: None,
                        registration: None,
                        typecode: None,
                        callsign: None,
                    })
                    .latitude = Some(value);
            }
        }

        // Process longitude data
        if let Ok(lon_data) = lon_data_result {
            for (timestamp, value) in lon_data {
                let ts_sec = timestamp as f64 / 1000.0;
                results
                    .entry(timestamp)
                    .or_insert_with(|| TrackPoint {
                        timestamp: ts_sec,
                        icao24: icao24.to_string(),
                        latitude: None,
                        longitude: None,
                        altitude: None,
                        track: None,
                        registration: None,
                        typecode: None,
                        callsign: None,
                    })
                    .longitude = Some(value);
            }
        }

        // Process altitude data
        if let Ok(alt_data) = alt_data_result {
            for (timestamp, value) in alt_data {
                let ts_sec = timestamp as f64 / 1000.0;
                results
                    .entry(timestamp)
                    .or_insert_with(|| TrackPoint {
                        timestamp: ts_sec,
                        icao24: icao24.to_string(),
                        latitude: None,
                        longitude: None,
                        altitude: None,
                        track: None,
                        registration: None,
                        typecode: None,
                        callsign: None,
                    })
                    .altitude = Some(value);
            }
        }

        // Process track data
        if let Ok(track_data) = track_data_result {
            for (timestamp, value) in track_data {
                let ts_sec = timestamp as f64 / 1000.0;
                results
                    .entry(timestamp)
                    .or_insert_with(|| TrackPoint {
                        timestamp: ts_sec,
                        icao24: icao24.to_string(),
                        latitude: None,
                        longitude: None,
                        altitude: None,
                        track: None,
                        registration: None,
                        typecode: None,
                        callsign: None,
                    })
                    .track = Some(value);
            }
        }

        // Get aircraft metadata to enrich track points
        if let Ok(Some(aircraft)) = self.get_aircraft(icao24).await {
            for (_timestamp, point) in results.iter_mut() {
                point.registration = aircraft.registration.clone();
                point.typecode = aircraft.typecode.clone();
                point.callsign = aircraft.callsign.clone();
            }
        }

        // Convert to a vector and sort by timestamp
        let mut track: Vec<TrackPoint> = results.into_values().collect();
        track.sort_by(|a, b| {
            a.timestamp
                .partial_cmp(&b.timestamp)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        Ok(track)
    }

    pub async fn get_current_positions(&self) -> Result<Vec<StateVector>> {
        let aircraft_table = self.get_aircraft_table().await?;

        // Filter for aircraft with position data
        Ok(aircraft_table
            .into_values()
            .filter(|aircraft| {
                aircraft.latitude.is_some() && aircraft.longitude.is_some()
            })
            .collect())
    }

    pub async fn get_aircraft_count(&self) -> Result<usize> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let keys: Vec<String> = conn.keys("aircraft:current:*").await?;
        Ok(keys.len())
    }

    pub async fn get_timeseries_info(
        &self, icao24: &str,
    ) -> Result<HashMap<String, HashMap<String, String>>> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let mut result = HashMap::new();

        let keys = [
            format!("aircraft:ts:latitude:{}", icao24),
            format!("aircraft:ts:longitude:{}", icao24),
            format!("aircraft:ts:altitude:{}", icao24),
            format!("aircraft:ts:track:{}", icao24),
        ];

        for key in &keys {
            let info_result: RedisResult<HashMap<String, String>> =
                redis::cmd("TS.INFO").arg(key).query_async(&mut conn).await;

            match info_result {
                Ok(info) => {
                    result.insert(key.clone(), info);
                }
                Err(_) => {} // Skip if the time series doesn't exist
            }
        }

        Ok(result)
    }

    pub async fn get_timeseries_labels(
        &self, icao24: &str,
    ) -> Result<HashMap<String, HashMap<String, String>>> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let mut result = HashMap::new();

        let keys = [
            format!("aircraft:ts:latitude:{}", icao24),
            format!("aircraft:ts:longitude:{}", icao24),
            format!("aircraft:ts:altitude:{}", icao24),
            format!("aircraft:ts:track:{}", icao24),
        ];

        for key in &keys {
            let info_result: RedisResult<HashMap<String, String>> =
                redis::cmd("TS.INFO").arg(key).query_async(&mut conn).await;

            match info_result {
                Ok(info) => {
                    if let Some(labels_str) = info.get("labels") {
                        // Parse the labels from the string representation
                        let labels: HashMap<String, String> = labels_str
                            .split(',')
                            .filter_map(|pair| {
                                let parts: Vec<&str> = pair.split('=').collect();
                                if parts.len() == 2 {
                                    Some((parts[0].to_string(), parts[1].to_string()))
                                } else {
                                    None
                                }
                            })
                            .collect();

                        result.insert(key.clone(), labels);
                    }
                }
                Err(_) => {} // Skip if the time series doesn't exist
            }
        }

        Ok(result)
    }
}

/// TUI Application for displaying real-time aircraft data
pub struct TuiApp {
    client: StateClient,
    should_quit: bool,
    refresh_interval: Duration,
}

impl TuiApp {
    pub async fn new() -> Result<Self> {
        let client = StateClient::new(None).await?;

        Ok(Self {
            client,
            should_quit: false,
            refresh_interval: Duration::from_secs(1),
        })
    }

    pub async fn run(&mut self) -> Result<()> {
        // Terminal initialization
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        // Main loop
        let tick_rate = self.refresh_interval;
        let mut last_tick = std::time::Instant::now();

        while !self.should_quit {
            terminal.draw(|f| {
                // Use block instead of await for synchronous render in draw closure
                match self.render_ui(f) {
                    Ok(_) => {}
                    Err(e) => error!("Failed to render UI: {}", e),
                }
            })?;

            let timeout = tick_rate
                .checked_sub(last_tick.elapsed())
                .unwrap_or_else(|| Duration::from_secs(0));

            if event::poll(timeout)? {
                if let Event::Key(key) = event::read()? {
                    if key.code == KeyCode::Char('q') {
                        self.should_quit = true;
                    }
                }
            }

            if last_tick.elapsed() >= tick_rate {
                last_tick = std::time::Instant::now();
            }
        }

        // Restore terminal
        disable_raw_mode()?;
        execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
        terminal.show_cursor()?;

        Ok(())
    }

    fn render_ui(&mut self, frame: &mut ratatui::Frame) -> Result<()> {
        // Get current time
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let now_secs_f64 = now.as_secs_f64();

        // Format current time for display
        let current_time = {
            let secs = now.as_secs();
            let hours = (secs % 86400) / 3600;
            let minutes = (secs % 3600) / 60;
            let seconds = secs % 60;
            format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                1970 + (secs / 31536000), // Simple year approximation
                (secs % 31536000) / 2592000 + 1, // Month approximation
                (secs % 2592000) / 86400 + 1, // Day approximation
                hours,
                minutes,
                seconds
            )
        };

        // Use a static placeholder while we fetch data
        let maybe_data = match tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(async { self.client.get_aircraft_table().await })
        }) {
            Ok(data) => data,
            Err(e) => {
                // In case of error, display message and return
                let error_text = format!("Error fetching data: {}", e);
                let block = Block::default().title(error_text).borders(Borders::ALL);
                frame.render_widget(block, frame.size());
                return Ok(());
            }
        };

        let aircraft_data = maybe_data;
        let aircraft_count = aircraft_data.len();

        // Create chunks for UI layout
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .margin(1) // Smaller margin
            .constraints(
                [
                    Constraint::Length(1), // Time display
                    Constraint::Length(3), // Title
                    Constraint::Min(0),    // Table
                    Constraint::Length(1), // Footer
                ]
                .as_ref(),
            )
            .split(frame.size());

        // Current time display
        let time_text = Paragraph::new(format!("Time: {}", current_time))
            .style(Style::default().fg(Color::Cyan));
        frame.render_widget(time_text, chunks[0]);

        // Title block
        let title = format!(
            "Aircraft Data - Redis Time Series Monitor ({} aircraft)",
            aircraft_count
        );
        let title_block = Block::default()
            .title(Span::styled(
                title,
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ))
            .borders(Borders::ALL);
        frame.render_widget(title_block, chunks[1]);

        // Table data - use smaller text style for entire table
        let small_text_style = Style::default().add_modifier(Modifier::DIM);

        let header_cells = [
            "ICAO24",
            "Callsign",
            "Latitude",
            "Longitude",
            "Altitude",
            "Track",
            "Last Seen",
            "First Seen",
        ]
        .iter()
        .map(|h| {
            Cell::from(*h).style(
                Style::default()
                    .fg(Color::LightCyan)
                    .add_modifier(Modifier::BOLD),
            )
        });

        let header = Row::new(header_cells).height(1).bottom_margin(1);

        let mut rows = Vec::new();
        // Sort by last seen time, most recent first
        let mut sortable_data: Vec<_> = aircraft_data.into_iter().collect();
        sortable_data.sort_by(|a, b| {
            b.1.lastseen
                .partial_cmp(&a.1.lastseen)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        for (icao24, aircraft) in sortable_data {
            let age_secs = now_secs_f64 - aircraft.lastseen;

            // Format last seen with more precision
            let last_seen = format!("{:.1}s ago", age_secs);

            // Format first seen time as actual time
            let first_seen_datetime =
                UNIX_EPOCH + Duration::from_secs_f64(aircraft.firstseen);
            let first_seen = format!(
                "{:02}:{:02}:{:02}",
                first_seen_datetime
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
                    % 86400
                    / 3600,
                first_seen_datetime
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
                    % 3600
                    / 60,
                first_seen_datetime
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
                    % 60
            );

            // Determine row color based on last seen time
            let row_style = if age_secs < 60.0 {
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::DIM)
            } else if age_secs < 300.0 {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::DIM)
            } else {
                Style::default().fg(Color::Gray).add_modifier(Modifier::DIM)
            };

            // Format latitude/longitude with aligned decimal points
            // Use empty string instead of "N/A"
            let latitude = aircraft
                .latitude
                .map_or("".to_string(), |lat| format!("{:>8.4}", lat));

            let longitude = aircraft
                .longitude
                .map_or("".to_string(), |lon| format!("{:>8.4}", lon));

            // Empty string for missing altitude/track
            let altitude = aircraft
                .altitude
                .map_or("".to_string(), |alt| format!("{:>7.0}", alt));

            let track = aircraft
                .track
                .map_or("".to_string(), |trk| format!("{:>5.0}°", trk));

            let callsign = aircraft.callsign.unwrap_or_else(|| "".to_string());

            // Create the row
            let cells = vec![
                Cell::from(icao24),
                Cell::from(callsign),
                Cell::from(latitude),
                Cell::from(longitude),
                Cell::from(altitude),
                Cell::from(track),
                Cell::from(last_seen),
                Cell::from(first_seen),
            ];

            rows.push(Row::new(cells).style(row_style));
        }

        // Update table widths for optimized layout
        let widths = [
            Constraint::Length(8),  // ICAO24
            Constraint::Length(8),  // Callsign
            Constraint::Length(10), // Latitude
            Constraint::Length(10), // Longitude
            Constraint::Length(8),  // Altitude
            Constraint::Length(7),  // Track
            Constraint::Length(10), // Last Seen
            Constraint::Length(10), // First Seen
        ];

        let t = Table::new(rows)
            .header(header)
            .block(
                Block::default()
                    .title("Aircraft Table")
                    .borders(Borders::ALL),
            )
            .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
            .widths(&widths)
            .style(small_text_style); // smaller text style
        frame.render_widget(t, chunks[2]);
        // Footer with instructions
        let footer = Paragraph::new("quit: q").style(
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::DIM),
        );
        frame.render_widget(footer, chunks[3]);

        Ok(())
    }
}

// Add a command line option to run in TUI mode
#[derive(Parser, Debug)]
#[clap(
    author,
    version,
    about = "Aircraft history recording service using Redis Time Series"
)]
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

    /// Run in TUI mode to display aircraft data
    #[clap(long)]
    tui: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables from a .env file
    dotenv::dotenv().ok();

    // Initialize tracing
    let file_appender =
        tracing_appender::rolling::daily("/tmp/tangram", "history_redis_ts.log");
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

    // If TUI mode is requested, start the TUI application
    if args.tui {
        info!("Starting TUI mode...");
        let mut tui_app = TuiApp::new().await?;
        return tui_app.run().await;
    }

    // Initialize Redis state vectors with time series support
    let state_vectors = Arc::new(Mutex::new(
        RedisTimeSeriesState::new(
            &args.redis_url,
            args.aggregation_interval,
            args.history_expiry
        )
        .await?,
    ));

    // Start the Jet1090 subscriber
    info!("Starting aircraft history recorder with Redis Time Series...");
    info!("Using Redis at: {}", args.redis_url);
    info!("Using aggregation interval of {} seconds", args.aggregation_interval);
    info!("History data will expire after {} seconds", args.history_expiry);

    // Run the Jet1090 subscriber and wait for it to complete
    match start_jet1090_subscriber(args.redis_url, args.jet1090_channel, state_vectors)
        .await
    {
        Ok(_) => info!("Jet1090 subscriber stopped normally"),
        Err(e) => error!("Jet1090 subscriber error: {}", e),
    }

    Ok(())
}

// Start a Redis subscriber to listen for Jet1090 messages
async fn start_jet1090_subscriber(
    redis_url: String, channel: String, state_vectors: Arc<Mutex<RedisTimeSeriesState>>,
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

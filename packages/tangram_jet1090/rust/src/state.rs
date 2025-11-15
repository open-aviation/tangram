use anyhow::Result;
use redis::aio::MultiplexedConnection;
use rs1090::data::patterns::aircraft_information;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    time::{SystemTime, UNIX_EPOCH},
};
use tangram_core::stream::{Positioned, StateCollection, Tracked};
use tracing::{debug, error};

use crate::{
    // TODO import this one from the rs1090 crate after release
    aircraftdb::{aircraft, Aircraft},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
/// BDS40 message format
pub struct BDS40Message {
    pub selected_altitude: Option<u16>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// BDS50 message format
pub struct BDS50Message {
    pub roll: Option<f64>,
    pub track: Option<f64>,
    pub groundspeed: Option<f64>,
    pub tas: Option<u16>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// BDS50 message format
pub struct BDS60Message {
    pub ias: Option<u16>,
    pub mach: Option<f64>,
    pub heading: Option<f64>,
    pub vrate_barometric: Option<i16>,
    pub vrate_inertial: Option<i16>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Jet1090 message format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Jet1090Message {
    pub icao24: String,
    pub df: String,
    pub bds: Option<String>,
    pub timestamp: f64,
    pub callsign: Option<String>,
    pub altitude: Option<u16>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub track: Option<f64>,
    pub selected_altitude: Option<u16>,
    pub groundspeed: Option<f64>,
    pub vertical_rate: Option<i16>,
    pub ias: Option<u16>,
    pub tas: Option<u16>,
    pub nacp: Option<u8>,
    pub bds40: Option<BDS40Message>,
    pub bds50: Option<BDS50Message>,
    pub bds60: Option<BDS60Message>,
    pub squawk: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateVector {
    /// The ICAO 24-bit address of the aircraft transponder
    pub icao24: String,
    /// The timestamp of the first seen message
    pub firstseen: u64,
    /// The timestamp of the last seen message
    pub lastseen: u64,
    /// The callsign of the aircraft, ICAO flight number for commercial aircraft, often matches registration in General Aviation.
    pub callsign: Option<String>,
    /// The tail number of the aircraft. If the aircraft is not known in the local database, some heuristics may reconstruct the tail number in some countries.
    pub registration: Option<String>,
    /// The ICAO code to the type of aircraft, e.g. A32O or B789
    pub typecode: Option<String>,
    /// The squawk code, a 4-digit number set on the transponder, 7700 for general emergencies
    pub squawk: Option<u16>, // IdentityCode
    /// WGS84 latitude angle in degrees
    pub latitude: Option<f64>,
    /// WGS84 longitude angle in degrees
    pub longitude: Option<f64>,
    /// Barometric altitude in feet, expressed in ISA
    pub altitude: Option<u16>,
    /// Altitude selected in the FMS
    pub selected_altitude: Option<u16>,
    /// Ground speed, in knots
    pub groundspeed: Option<f64>,
    /// Vertical rate of the aircraft, in feet/min
    pub vertical_rate: Option<i16>,
    /// The true track angle of the aircraft in degrees with respect to the geographic North
    pub track: Option<f64>,
    /// Indicated air speed, in knots
    pub ias: Option<u16>,
    /// True air speed, in knots
    pub tas: Option<u16>,
    /// The Mach number
    pub mach: Option<f64>,
    /// The roll angle of the aircraft in degrees (positive angle for banking to the right-hand side)
    pub roll: Option<f64>,
    /// The magnetic heading of the aircraft in degrees with respect to the magnetic North
    pub heading: Option<f64>,
    /// The NAC position indicator, for uncertainty
    pub nacp: Option<u8>,
    /// Number of messages received for the aircraft
    pub count: usize,
}

impl Positioned for StateVector {
    fn latitude(&self) -> Option<f64> {
        self.latitude
    }
    fn longitude(&self) -> Option<f64> {
        self.longitude
    }
}

impl Tracked for StateVector {
    fn lastseen(&self) -> u64 {
        self.lastseen
    }
}

impl StateCollection for StateVectors {
    type Item = StateVector;
    fn get_all(&self) -> Vec<Self::Item> {
        self.aircraft.values().cloned().collect()
    }
    fn history_expire_secs(&self) -> u64 {
        self.history_expire as u64
    }
}

async fn ensure_timeseries_exists(
    key: &str,
    labels: HashMap<String, String>,
    history_expire: u16,
    conn: &mut redis::aio::MultiplexedConnection,
) -> Result<bool> {
    // Check if the time series exists
    let exists: bool = redis::cmd("TS.INFO")
        .arg(key)
        .query_async(conn)
        .await
        .map(|_: ()| true)
        .unwrap_or(false);

    if exists {
        return Ok(true);
    }

    // Create the time series if it doesn't exist
    let mut cmd = redis::cmd("TS.CREATE");
    cmd.arg(key);
    cmd.arg("RETENTION").arg((history_expire as i64) * 1000);

    // Set duplicate policy to LAST to allow updating values
    cmd.arg("DUPLICATE_POLICY").arg("LAST");

    // Add labels
    if !labels.is_empty() {
        cmd.arg("LABELS");
        for (k, v) in &labels {
            cmd.arg(k).arg(v);
        }
    }

    match cmd.query_async::<()>(conn).await {
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

async fn insert_value(
    icao24: &str,
    timestamp: f64,
    label: String,
    value: f64,
    mut labels: HashMap<String, String>,
    history_expire: u16,
    conn: &mut redis::aio::MultiplexedConnection,
) -> Result<()> {
    debug!(
        "Inserted value {}={} for {} at {}",
        label, value, icao24, timestamp
    );
    let key = format!("aircraft:ts:{}:{}", label, icao24);
    labels.insert("type".to_string(), label);
    if ensure_timeseries_exists(&key, labels, history_expire, conn).await? {
        // Use TS.ADD with DUPLICATE_POLICY LAST to handle duplicate timestamps
        redis::cmd("TS.ADD")
            .arg(&key)
            .arg((timestamp * 1000.) as u64)
            .arg(value)
            .query_async::<()>(conn)
            .await?;
    }
    Ok(())
}

/// State vectors collection to track aircraft
#[derive(Debug)]
pub struct StateVectors {
    pub aircraft: HashMap<String, StateVector>,
    pub aircraft_db: BTreeMap<String, Aircraft>,
    pub redis_conn: MultiplexedConnection,
    pub history_expire: u16,
}

impl StateVectors {
    pub async fn new(
        expire: u16,
        redis_client: redis::Client,
        aircraft_db_url: String,
        aircraft_db_cache_path: Option<String>,
    ) -> Result<Self> {
        let redis_conn = redis_client.get_multiplexed_async_connection().await?;
        Ok(Self {
            aircraft: HashMap::new(),
            aircraft_db: aircraft(aircraft_db_url, aircraft_db_cache_path).await,
            redis_conn,
            history_expire: expire,
        })
    }

    pub async fn add(&mut self, msg: &Jet1090Message) -> Result<()> {
        // Skip messages that don't match criteria
        if msg.df != "17" && msg.df != "18" && msg.df != "20" && msg.df != "21" {
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
                firstseen: 0,
                lastseen: now as u64,
                callsign: msg.callsign.clone(),
                registration,
                typecode,
                squawk: None,
                latitude: None,
                longitude: None,
                altitude: None,
                selected_altitude: None,
                groundspeed: None,
                vertical_rate: None,
                track: None,
                ias: None,
                tas: None,
                mach: None,
                roll: None,
                heading: None,
                nacp: None,
                count: 0,
            }
        });

        let mut common_labels = HashMap::new();
        common_labels.insert("icao24".to_string(), msg.icao24.clone());

        let conn = &mut self.redis_conn;

        sv.count += 1;
        if sv.firstseen == 0 {
            sv.firstseen = msg.timestamp as u64;
        }
        sv.lastseen = msg.timestamp as u64;
        if msg.df == "18" {
            sv.typecode = Some("GRND".to_string());
        }
        if let Some(altitude) = msg.altitude {
            sv.altitude = Some(altitude);
            insert_value(
                &msg.icao24,
                msg.timestamp,
                "altitude".to_string(),
                altitude as f64,
                common_labels.clone(),
                self.history_expire,
                conn,
            )
            .await?;
        }
        if let Some(squawk) = &msg.squawk {
            if let Ok(squawk_val) = squawk.parse::<u16>() {
                sv.squawk = Some(squawk_val);
            }
        }
        match &msg.bds {
            Some(val) if val == "05" => {
                if let Some(latitude) = msg.latitude {
                    sv.latitude = Some(latitude);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "latitude".to_string(),
                        latitude,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(longitude) = msg.longitude {
                    sv.longitude = Some(longitude);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "longitude".to_string(),
                        longitude,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
            }
            Some(val) if val == "06" => {
                if let Some(latitude) = msg.latitude {
                    sv.latitude = Some(latitude);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "latitude".to_string(),
                        latitude,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(longitude) = msg.longitude {
                    sv.longitude = Some(longitude);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "longitude".to_string(),
                        longitude,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(groundspeed) = msg.groundspeed {
                    sv.groundspeed = Some(groundspeed);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "groundspeed".to_string(),
                        groundspeed,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(track) = msg.track {
                    sv.track = Some(track);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "track".to_string(),
                        track,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
            }
            Some(val) if val == "08" => {
                if let Some(callsign) = &msg.callsign {
                    sv.callsign = Some(callsign.clone());
                }
            }
            Some(val) if val == "09" => {
                if let Some(groundspeed) = msg.groundspeed {
                    sv.groundspeed = Some(groundspeed);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "groundspeed".to_string(),
                        groundspeed,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(track) = msg.track {
                    sv.track = Some(track);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "track".to_string(),
                        track,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(vertical_rate) = msg.vertical_rate {
                    sv.vertical_rate = Some(vertical_rate);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "vertical_rate".to_string(),
                        vertical_rate as f64,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(ias) = msg.ias {
                    sv.ias = Some(ias);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "ias".to_string(),
                        ias as f64,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
                if let Some(tas) = msg.tas {
                    sv.tas = Some(tas);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "tas".to_string(),
                        tas as f64,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
            }
            Some(val) if val == "61" => {
                if let Some(squawk_str) = &msg.squawk {
                    if let Ok(squawk_val) = squawk_str.parse::<u16>() {
                        sv.squawk = Some(squawk_val);
                    }
                }
            }
            Some(val) if val == "62" => {
                if let Some(selected_altitude) = msg.selected_altitude {
                    sv.selected_altitude = Some(selected_altitude);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "selected_altitude".to_string(),
                        selected_altitude as f64,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
            }
            Some(val) if val == "65" => {
                if let Some(nacp) = msg.nacp {
                    sv.nacp = Some(nacp);
                    insert_value(
                        &msg.icao24,
                        msg.timestamp,
                        "nacp".to_string(),
                        nacp as f64,
                        common_labels.clone(),
                        self.history_expire,
                        conn,
                    )
                    .await?;
                }
            }
            _ => {}
        }
        if let Some(bds40) = &msg.bds40 {
            sv.selected_altitude = bds40.selected_altitude;
            if let Some(selected_altitude) = bds40.selected_altitude {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "selected_altitude".to_string(),
                    selected_altitude as f64,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
        }
        if let Some(bds50) = &msg.bds50 {
            sv.roll = bds50.roll;
            sv.track = bds50.track;
            sv.groundspeed = bds50.groundspeed;
            sv.tas = bds50.tas;
            if let Some(roll) = bds50.roll {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "roll".to_string(),
                    roll,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
            if let Some(track) = bds50.track {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "track".to_string(),
                    track,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
            if let Some(groundspeed) = bds50.groundspeed {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "groundspeed".to_string(),
                    groundspeed,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
            if let Some(tas) = bds50.tas {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "tas".to_string(),
                    tas as f64,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
        }
        if let Some(bds60) = &msg.bds60 {
            sv.ias = bds60.ias;
            sv.mach = bds60.mach;
            sv.heading = bds60.heading;
            sv.vertical_rate = bds60.vrate_inertial;
            if let Some(ias) = bds60.ias {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "ias".to_string(),
                    ias as f64,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
            if let Some(mach) = bds60.mach {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "mach".to_string(),
                    mach,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
            if let Some(heading) = bds60.heading {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "heading".to_string(),
                    heading,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
            if let Some(vrate_inertial) = bds60.vrate_inertial {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "vrate_inertial".to_string(),
                    vrate_inertial as f64,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
            if let Some(vrate_barometric) = bds60.vrate_barometric {
                insert_value(
                    &msg.icao24,
                    msg.timestamp,
                    "vrate_barometric".to_string(),
                    vrate_barometric as f64,
                    common_labels.clone(),
                    self.history_expire,
                    conn,
                )
                .await?;
            }
        }

        Ok(())
    }
}

use anyhow::Result;
use arrow_array::{
    ArrayRef, Float64Array, Int16Array, Int32Array, Int8Array, RecordBatch, StringArray,
    TimestampMicrosecondArray,
};
use arrow_schema::{DataType as ArrowDataType, Field, Schema as ArrowSchema, TimeUnit};
#[cfg(feature = "pyo3")]
use pyo3::prelude::*;
#[cfg(feature = "pyo3")]
use pyo3_stub_gen::derive::*;
use rs1090::data::patterns::aircraft_information;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tangram_core::stream::{Positioned, StateCollection, Tracked};
use tangram_history::client::{HistoryBuffer, HistoryFrame};

#[cfg_attr(feature = "pyo3", gen_stub_pyclass)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aircraft {
    pub typecode: Option<String>,
    pub registration: Option<String>,
}

#[cfg(feature = "pyo3")]
#[gen_stub_pymethods]
#[pymethods]
impl Aircraft {
    #[new]
    fn new(typecode: Option<String>, registration: Option<String>) -> Self {
        Self {
            typecode,
            registration,
        }
    }
}

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

impl HistoryFrame for Jet1090HistoryFrame {
    fn table_schema() -> Arc<ArrowSchema> {
        Self::table_schema()
    }
    fn to_record_batch(frames: &[&Self]) -> Result<RecordBatch> {
        Self::to_record_batch(frames)
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Jet1090HistoryFrame {
    pub icao24: String,
    pub timestamp: i64,
    pub df: i8,
    pub bds: Option<String>,
    pub callsign: Option<String>,
    pub altitude: Option<i32>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub track: Option<f64>,
    pub selected_altitude: Option<i32>,
    pub groundspeed: Option<f64>,
    pub vertical_rate: Option<i16>,
    pub ias: Option<i16>,
    pub tas: Option<i16>,
    pub nacp: Option<i8>,
    pub bds40_selected_altitude: Option<i32>,
    pub bds50_roll: Option<f64>,
    pub bds50_track: Option<f64>,
    pub bds50_groundspeed: Option<f64>,
    pub bds50_tas: Option<i16>,
    pub bds60_ias: Option<i16>,
    pub bds60_mach: Option<f64>,
    pub bds60_heading: Option<f64>,
    pub bds60_vrate_barometric: Option<i16>,
    pub bds60_vrate_inertial: Option<i16>,
    pub squawk: Option<i16>,
}

impl From<&Jet1090Message> for Jet1090HistoryFrame {
    fn from(msg: &Jet1090Message) -> Self {
        Self {
            icao24: msg.icao24.clone(),
            timestamp: (msg.timestamp * 1_000_000.0) as i64,
            df: msg.df.parse().unwrap_or(0),
            bds: msg.bds.clone(),
            callsign: msg.callsign.clone(),
            altitude: msg.altitude.map(|v| v as i32),
            latitude: msg.latitude,
            longitude: msg.longitude,
            track: msg.track,
            selected_altitude: msg.selected_altitude.map(|v| v as i32),
            groundspeed: msg.groundspeed,
            vertical_rate: msg.vertical_rate,
            ias: msg.ias.map(|v| v as i16),
            tas: msg.tas.map(|v| v as i16),
            nacp: msg.nacp.map(|v| v as i8),
            bds40_selected_altitude: msg
                .bds40
                .as_ref()
                .and_then(|b| b.selected_altitude.map(|v| v as i32)),
            bds50_roll: msg.bds50.as_ref().and_then(|b| b.roll),
            bds50_track: msg.bds50.as_ref().and_then(|b| b.track),
            bds50_groundspeed: msg.bds50.as_ref().and_then(|b| b.groundspeed),
            bds50_tas: msg.bds50.as_ref().and_then(|b| b.tas.map(|v| v as i16)),
            bds60_ias: msg.bds60.as_ref().and_then(|b| b.ias.map(|v| v as i16)),
            bds60_mach: msg.bds60.as_ref().and_then(|b| b.mach),
            bds60_heading: msg.bds60.as_ref().and_then(|b| b.heading),
            bds60_vrate_barometric: msg.bds60.as_ref().and_then(|b| b.vrate_barometric),
            bds60_vrate_inertial: msg.bds60.as_ref().and_then(|b| b.vrate_inertial),
            squawk: msg.squawk.as_ref().and_then(|s| s.parse().ok()),
        }
    }
}

impl Jet1090HistoryFrame {
    /// Schema for the jet1090 history table.
    ///
    /// Delta lake does not support unsigned integers. To avoid implicit cast, we modify:
    /// - altitude, selected_altitude: u16 -> i32 (i16::MAX = 32767 so its not sufficient)
    /// - ias, tas: u16 -> i16
    /// - nacp: u8 -> i8
    /// - squawk: u16 -> i16 (max 0x7777 = 30583 so ok)
    pub fn table_schema() -> Arc<ArrowSchema> {
        let mut fields = Self::data_schema_fields();
        let mut metadata = HashMap::new();
        metadata.insert(
            "delta.generationExpression".to_string(),
            "CAST(timestamp AS DATE)".to_string(),
        );
        fields.insert(
            2,
            Field::new("date", ArrowDataType::Date32, false).with_metadata(metadata),
        );
        Arc::new(ArrowSchema::new(fields))
    }

    pub fn data_schema() -> Arc<ArrowSchema> {
        Arc::new(ArrowSchema::new(Self::data_schema_fields()))
    }

    fn data_schema_fields() -> Vec<Field> {
        vec![
            Field::new("icao24", ArrowDataType::Utf8, false),
            Field::new(
                "timestamp",
                ArrowDataType::Timestamp(TimeUnit::Microsecond, None),
                false,
            ),
            Field::new("df", ArrowDataType::Int8, false),
            Field::new("bds", ArrowDataType::Utf8, true),
            Field::new("callsign", ArrowDataType::Utf8, true),
            Field::new("altitude", ArrowDataType::Int32, true),
            Field::new("latitude", ArrowDataType::Float64, true),
            Field::new("longitude", ArrowDataType::Float64, true),
            Field::new("track", ArrowDataType::Float64, true),
            Field::new("selected_altitude", ArrowDataType::Int32, true),
            Field::new("groundspeed", ArrowDataType::Float64, true),
            Field::new("vertical_rate", ArrowDataType::Int16, true),
            Field::new("ias", ArrowDataType::Int16, true),
            Field::new("tas", ArrowDataType::Int16, true),
            Field::new("nacp", ArrowDataType::Int8, true),
            Field::new("bds40_selected_altitude", ArrowDataType::Int32, true),
            Field::new("bds50_roll", ArrowDataType::Float64, true),
            Field::new("bds50_track", ArrowDataType::Float64, true),
            Field::new("bds50_groundspeed", ArrowDataType::Float64, true),
            Field::new("bds50_tas", ArrowDataType::Int16, true),
            Field::new("bds60_ias", ArrowDataType::Int16, true),
            Field::new("bds60_mach", ArrowDataType::Float64, true),
            Field::new("bds60_heading", ArrowDataType::Float64, true),
            Field::new("bds60_vrate_barometric", ArrowDataType::Int16, true),
            Field::new("bds60_vrate_inertial", ArrowDataType::Int16, true),
            Field::new("squawk", ArrowDataType::Int16, true),
        ]
    }

    pub fn to_record_batch(frames: &[&Self]) -> Result<RecordBatch> {
        let schema = Self::data_schema();
        let columns: Vec<ArrayRef> = vec![
            Arc::new(StringArray::from_iter_values(
                frames.iter().map(|f| &f.icao24),
            )),
            Arc::new(TimestampMicrosecondArray::from_iter_values(
                frames.iter().map(|f| f.timestamp),
            )),
            Arc::new(Int8Array::from_iter_values(frames.iter().map(|f| f.df))),
            Arc::new(StringArray::from_iter(
                frames.iter().map(|f| f.bds.as_ref()),
            )),
            Arc::new(StringArray::from_iter(
                frames.iter().map(|f| f.callsign.as_ref()),
            )),
            Arc::new(Int32Array::from_iter(frames.iter().map(|f| f.altitude))),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.latitude))),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.longitude))),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.track))),
            Arc::new(Int32Array::from_iter(
                frames.iter().map(|f| f.selected_altitude),
            )),
            Arc::new(Float64Array::from_iter(
                frames.iter().map(|f| f.groundspeed),
            )),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.vertical_rate),
            )),
            Arc::new(Int16Array::from_iter(frames.iter().map(|f| f.ias))),
            Arc::new(Int16Array::from_iter(frames.iter().map(|f| f.tas))),
            Arc::new(Int8Array::from_iter(frames.iter().map(|f| f.nacp))),
            Arc::new(Int32Array::from_iter(
                frames.iter().map(|f| f.bds40_selected_altitude),
            )),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.bds50_roll))),
            Arc::new(Float64Array::from_iter(
                frames.iter().map(|f| f.bds50_track),
            )),
            Arc::new(Float64Array::from_iter(
                frames.iter().map(|f| f.bds50_groundspeed),
            )),
            Arc::new(Int16Array::from_iter(frames.iter().map(|f| f.bds50_tas))),
            Arc::new(Int16Array::from_iter(frames.iter().map(|f| f.bds60_ias))),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.bds60_mach))),
            Arc::new(Float64Array::from_iter(
                frames.iter().map(|f| f.bds60_heading),
            )),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.bds60_vrate_barometric),
            )),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.bds60_vrate_inertial),
            )),
            Arc::new(Int16Array::from_iter(frames.iter().map(|f| f.squawk))),
        ];
        Ok(RecordBatch::try_new(schema, columns)?)
    }
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
    fn state_vector_expire_secs(&self) -> u64 {
        self.state_vector_expire as u64
    }
}

#[derive(Debug)]
pub struct StateVectors {
    pub aircraft: HashMap<String, StateVector>,
    pub aircraft_db: BTreeMap<String, Aircraft>,
    pub state_vector_expire: u16,
    history_buffer: Option<HistoryBuffer<Jet1090HistoryFrame>>,
}

impl StateVectors {
    pub fn new(
        expire: u16,
        aircraft_db: BTreeMap<String, Aircraft>,
        history_buffer: Option<HistoryBuffer<Jet1090HistoryFrame>>,
    ) -> Self {
        Self {
            aircraft: HashMap::new(),
            aircraft_db,
            state_vector_expire: expire,
            history_buffer,
        }
    }

    pub fn set_history_buffer(&mut self, buffer: HistoryBuffer<Jet1090HistoryFrame>) {
        self.history_buffer = Some(buffer);
    }

    pub async fn add(&mut self, msg: &Jet1090Message) -> Result<()> {
        if msg.df != "17" && msg.df != "18" && msg.df != "20" && msg.df != "21" {
            return Ok(());
        }

        let sv = self.aircraft.entry(msg.icao24.clone()).or_insert_with(|| {
            let mut registration = match aircraft_information(&msg.icao24, None) {
                Ok(aircraft_info) => aircraft_info.registration.clone(),
                Err(_) => None,
            };

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_micros() as u64;

            let mut typecode = None;

            if let Some(aircraft) = self.aircraft_db.get(&msg.icao24) {
                typecode = aircraft.typecode.clone();
                registration = aircraft.registration.clone();
            }
            StateVector {
                icao24: msg.icao24.clone(),
                firstseen: 0,
                lastseen: now,
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

        sv.count += 1;
        if sv.firstseen == 0 {
            sv.firstseen = (msg.timestamp * 1_000_000.0) as u64;
        }
        sv.lastseen = (msg.timestamp * 1_000_000.0) as u64;
        if msg.df == "18" {
            sv.typecode = Some("GRND".to_string());
        }
        if let Some(altitude) = msg.altitude {
            sv.altitude = Some(altitude);
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
                }
                if let Some(longitude) = msg.longitude {
                    sv.longitude = Some(longitude);
                }
            }
            Some(val) if val == "06" => {
                if let Some(latitude) = msg.latitude {
                    sv.latitude = Some(latitude);
                }
                if let Some(longitude) = msg.longitude {
                    sv.longitude = Some(longitude);
                }
                if let Some(groundspeed) = msg.groundspeed {
                    sv.groundspeed = Some(groundspeed);
                }
                if let Some(track) = msg.track {
                    sv.track = Some(track);
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
                }
                if let Some(track) = msg.track {
                    sv.track = Some(track);
                }
                if let Some(vertical_rate) = msg.vertical_rate {
                    sv.vertical_rate = Some(vertical_rate);
                }
                if let Some(ias) = msg.ias {
                    sv.ias = Some(ias);
                }
                if let Some(tas) = msg.tas {
                    sv.tas = Some(tas);
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
                }
            }
            Some(val) if val == "65" => {
                if let Some(nacp) = msg.nacp {
                    sv.nacp = Some(nacp);
                }
            }
            _ => {}
        }
        if let Some(bds40) = &msg.bds40 {
            sv.selected_altitude = bds40.selected_altitude;
        }
        if let Some(bds50) = &msg.bds50 {
            sv.roll = bds50.roll;
            sv.track = bds50.track;
            sv.groundspeed = bds50.groundspeed;
            sv.tas = bds50.tas;
        }
        if let Some(bds60) = &msg.bds60 {
            sv.ias = bds60.ias;
            sv.mach = bds60.mach;
            sv.heading = bds60.heading;
            sv.vertical_rate = bds60.vrate_inertial;
        }

        let frame = Jet1090HistoryFrame::from(msg);
        if let Some(buffer) = &self.history_buffer {
            buffer.add(frame).await;
        }
        Ok(())
    }
}
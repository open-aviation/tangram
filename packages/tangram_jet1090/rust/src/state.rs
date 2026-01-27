use anyhow::Result;
use arrow_array::{
    ArrayRef, Float64Array, Int16Array, Int32Array, Int8Array, RecordBatch, StringArray,
    TimestampMicrosecondArray,
};
use arrow_schema::{DataType as ArrowDataType, Field, Schema as ArrowSchema, TimeUnit};
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
#[cfg(feature = "pyo3")]
use pyo3::prelude::*;
#[cfg(feature = "stubgen")]
use pyo3_stub_gen::derive::*;
use rs1090::data::patterns::aircraft_information;
use rs1090::decode::bds::bds09::AirborneVelocitySubType::{AirspeedSubsonic, GroundSpeedDecoding};
use rs1090::decode::bds::bds09::AirspeedType::{IAS, TAS};
use rs1090::decode::bds::bds65::{
    ADSBVersionAirborne, ADSBVersionSurface, AircraftOperationStatus,
};
use rs1090::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};
use tangram_core::stream::{Identifiable, Positioned, StateCollection, Tracked};
use tangram_history::client::{HistoryBuffer, HistoryFrame};

#[cfg_attr(feature = "stubgen", gen_stub_pyclass)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aircraft {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typecode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration: Option<String>,
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callsign: Option<String>,
    /// The tail number of the aircraft. If the aircraft is not known in the local database, some heuristics may reconstruct the tail number in some countries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration: Option<String>,
    /// The ICAO code to the type of aircraft, e.g. A32O or B789
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typecode: Option<String>,
    /// The squawk code, a 4-digit number set on the transponder, 7700 for general emergencies
    #[serde(skip_serializing_if = "Option::is_none")]
    pub squawk: Option<u16>, // IdentityCode
    /// WGS84 latitude angle in degrees
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latitude: Option<f64>,
    /// WGS84 longitude angle in degrees
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitude: Option<f64>,
    /// Barometric altitude in feet, expressed in ISA
    #[serde(skip_serializing_if = "Option::is_none")]
    pub altitude: Option<i32>,
    /// Altitude selected in the FMS
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_altitude: Option<u16>,
    /// Ground speed, in knots
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groundspeed: Option<f64>,
    /// Vertical rate of the aircraft, in feet/min
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_rate: Option<i16>,
    /// The true track angle of the aircraft in degrees with respect to the geographic North
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<f64>,
    /// Indicated air speed, in knots
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ias: Option<u16>,
    /// True air speed, in knots
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tas: Option<u16>,
    /// The Mach number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mach: Option<f64>,
    /// The roll angle of the aircraft in degrees (positive angle for banking to the right-hand side)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roll: Option<f64>,
    /// The magnetic heading of the aircraft in degrees with respect to the magnetic North
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<f64>,
    /// The NAC position indicator, for uncertainty
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nacp: Option<u8>,
    /// Number of messages received for the aircraft
    pub count: usize,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub state: StateVector,
    pub score: u32,
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
    pub mach: Option<f64>,
    pub roll: Option<f64>,
    pub heading: Option<f64>,
    pub vrate_barometric: Option<i16>,
    pub vrate_inertial: Option<i16>,
    pub nacp: Option<i8>,
    pub squawk: Option<i16>,
}

impl From<&TimedMessage> for Jet1090HistoryFrame {
    fn from(msg: &TimedMessage) -> Self {
        let mut frame = Self {
            icao24: "".to_string(),
            timestamp: (msg.timestamp * 1_000_000.0) as i64,
            df: 0,
            bds: None,
            callsign: None,
            altitude: None,
            latitude: None,
            longitude: None,
            track: None,
            selected_altitude: None,
            groundspeed: None,
            vertical_rate: None,
            ias: None,
            tas: None,
            mach: None,
            roll: None,
            heading: None,
            vrate_barometric: None,
            vrate_inertial: None,
            nacp: None,
            squawk: None,
        };

        if let Some(message) = &msg.message {
            if let Some(icao) = icao24(message) {
                frame.icao24 = icao;
            }
            match &message.df {
                ShortAirAirSurveillance { ac, .. } => {
                    frame.df = 0;
                    frame.altitude = ac.0;
                }
                SurveillanceAltitudeReply { ac, .. } => {
                    frame.df = 4;
                    frame.altitude = ac.0;
                }
                SurveillanceIdentityReply { id, .. } => {
                    frame.df = 5;
                    frame.squawk = Some(id.0 as i16);
                }
                AllCallReply { .. } => {
                    frame.df = 11;
                }
                LongAirAirSurveillance { ac, .. } => {
                    frame.df = 16;
                    frame.altitude = ac.0;
                }
                ExtendedSquitterADSB(adsb) => {
                    frame.df = 17;
                    match &adsb.message {
                        ME::BDS05 { inner: bds05, .. } => {
                            frame.bds = Some("05".to_string());
                            frame.latitude = bds05.latitude;
                            frame.longitude = bds05.longitude;
                            frame.altitude = bds05.alt;
                        }
                        ME::BDS06 { inner: bds06, .. } => {
                            frame.bds = Some("06".to_string());
                            frame.latitude = bds06.latitude;
                            frame.longitude = bds06.longitude;
                            frame.track = bds06.track;
                            frame.groundspeed = bds06.groundspeed;
                        }
                        ME::BDS08 { inner: bds08, .. } => {
                            frame.bds = Some("08".to_string());
                            frame.callsign = Some(bds08.callsign.to_string());
                        }
                        ME::BDS09(bds09) => {
                            frame.bds = Some("09".to_string());
                            frame.vertical_rate = bds09.vertical_rate;
                            match &bds09.velocity {
                                GroundSpeedDecoding(spd) => {
                                    frame.groundspeed = Some(spd.groundspeed);
                                    frame.track = Some(spd.track)
                                }
                                AirspeedSubsonic(spd) => {
                                    match spd.airspeed_type {
                                        IAS => frame.ias = spd.airspeed.map(|v| v as i16),
                                        TAS => frame.tas = spd.airspeed.map(|v| v as i16),
                                    }
                                    frame.heading = spd.heading;
                                }
                                _ => {}
                            }
                        }
                        ME::BDS61(bds61) => {
                            frame.bds = Some("61".to_string());
                            frame.squawk = Some(bds61.squawk.0 as i16);
                        }
                        ME::BDS62(bds62) => {
                            frame.bds = Some("62".to_string());
                            frame.selected_altitude = bds62.selected_altitude.map(|v| v as i32);
                            frame.nacp = Some(bds62.nac_p as i8);
                        }
                        ME::BDS65(bds65) => {
                            frame.bds = Some("65".to_string());
                            match bds65 {
                                AircraftOperationStatus::Airborne(st) => {
                                    match st.version {
                                        rs1090::decode::bds::bds65::ADSBVersionAirborne::DOC9871AppendixB(v) => {
                                            frame.nacp = Some(v.nac_p as i8)
                                        }
                                        rs1090::decode::bds::bds65::ADSBVersionAirborne::DOC9871AppendixC(v) => {
                                            frame.nacp = Some(v.nac_p as i8)
                                        }
                                        _ => {}
                                    }
                                }
                                AircraftOperationStatus::Surface(st) => {
                                    match st.version {
                                        rs1090::decode::bds::bds65::ADSBVersionSurface::DOC9871AppendixB(v) => {
                                            frame.nacp = Some(v.nac_p as i8)
                                        }
                                        rs1090::decode::bds::bds65::ADSBVersionSurface::DOC9871AppendixC(v) => {
                                            frame.nacp = Some(v.nac_p as i8)
                                        }
                                        _ => {}
                                    }
                                }
                                _ => {}
                            }
                        }
                        _ => {}
                    }
                }
                ExtendedSquitterTisB { cf, .. } => {
                    frame.df = 18;
                    match &cf.me {
                        ME::BDS05 { inner: bds05, .. } => {
                            frame.bds = Some("05".to_string());
                            frame.latitude = bds05.latitude;
                            frame.longitude = bds05.longitude;
                            frame.altitude = bds05.alt;
                        }
                        ME::BDS06 { inner: bds06, .. } => {
                            frame.bds = Some("06".to_string());
                            frame.latitude = bds06.latitude;
                            frame.longitude = bds06.longitude;
                            frame.track = bds06.track;
                            frame.groundspeed = bds06.groundspeed;
                        }
                        ME::BDS08 { inner: bds08, .. } => {
                            frame.bds = Some("08".to_string());
                            frame.callsign = Some(bds08.callsign.to_string());
                        }
                        _ => {}
                    }
                }
                ExtendedSquitterMilitary { .. } => frame.df = 19,
                CommBAltitudeReply { bds, .. } => {
                    frame.df = 20;
                    if let Some(bds20) = &bds.bds20 {
                        frame.bds = Some("20".to_string());
                        frame.callsign = Some(bds20.callsign.to_string());
                    }
                    if let Some(bds40) = &bds.bds40 {
                        frame.bds = Some("40".to_string());
                        frame.selected_altitude = bds40.selected_altitude_mcp.map(|v| v as i32);
                    }
                    if let Some(bds50) = &bds.bds50 {
                        frame.bds = Some("50".to_string());
                        frame.roll = bds50.roll_angle;
                        frame.track = bds50.track_angle;
                        frame.groundspeed = bds50.groundspeed.map(|x| x as f64);
                        frame.tas = bds50.true_airspeed.map(|v| v as i16);
                    }
                    if let Some(bds60) = &bds.bds60 {
                        frame.bds = Some("60".to_string());
                        frame.ias = bds60.indicated_airspeed.map(|v| v as i16);
                        frame.mach = bds60.mach_number;
                        frame.heading = bds60.magnetic_heading;
                        if bds60.inertial_vertical_velocity.is_some() {
                            frame.vrate_inertial = bds60.inertial_vertical_velocity;
                        }
                        if bds60.barometric_altitude_rate.is_some() {
                            frame.vrate_barometric = bds60.barometric_altitude_rate;
                        }
                    }
                }
                CommBIdentityReply { bds, .. } => {
                    frame.df = 21;
                    if let Some(bds20) = &bds.bds20 {
                        frame.bds = Some("20".to_string());
                        frame.callsign = Some(bds20.callsign.to_string());
                    }
                    if let Some(bds40) = &bds.bds40 {
                        frame.bds = Some("40".to_string());
                        frame.selected_altitude = bds40.selected_altitude_mcp.map(|v| v as i32);
                    }
                    if let Some(bds50) = &bds.bds50 {
                        frame.bds = Some("50".to_string());
                        frame.roll = bds50.roll_angle;
                        frame.track = bds50.track_angle;
                        frame.groundspeed = bds50.groundspeed.map(|x| x as f64);
                        frame.tas = bds50.true_airspeed.map(|v| v as i16);
                    }
                    if let Some(bds60) = &bds.bds60 {
                        frame.bds = Some("60".to_string());
                        frame.ias = bds60.indicated_airspeed.map(|v| v as i16);
                        frame.mach = bds60.mach_number;
                        frame.heading = bds60.magnetic_heading;
                        if bds60.inertial_vertical_velocity.is_some() {
                            frame.vrate_inertial = bds60.inertial_vertical_velocity;
                        }
                        if bds60.barometric_altitude_rate.is_some() {
                            frame.vrate_barometric = bds60.barometric_altitude_rate;
                        }
                    }
                }
                CommDExtended { .. } => frame.df = 24,
            }
        }
        frame
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
            Field::new("mach", ArrowDataType::Float64, true),
            Field::new("roll", ArrowDataType::Float64, true),
            Field::new("heading", ArrowDataType::Float64, true),
            Field::new("vrate_barometric", ArrowDataType::Int16, true),
            Field::new("vrate_inertial", ArrowDataType::Int16, true),
            Field::new("nacp", ArrowDataType::Int8, true),
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
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.mach))),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.roll))),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.heading))),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.vrate_barometric),
            )),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.vrate_inertial),
            )),
            Arc::new(Int8Array::from_iter(frames.iter().map(|f| f.nacp))),
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

impl Identifiable for StateVector {
    fn id(&self) -> String {
        self.icao24.clone()
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

fn icao24(msg: &Message) -> Option<String> {
    match &msg.df {
        ShortAirAirSurveillance { ap, .. } => Some(ap.to_string()),
        SurveillanceAltitudeReply { ap, .. } => Some(ap.to_string()),
        SurveillanceIdentityReply { ap, .. } => Some(ap.to_string()),
        AllCallReply { icao, .. } => Some(icao.to_string()),
        LongAirAirSurveillance { ap, .. } => Some(ap.to_string()),
        ExtendedSquitterADSB(ADSB { icao24, .. }) => Some(icao24.to_string()),
        ExtendedSquitterTisB { cf, .. } => Some(cf.aa.to_string()),
        CommBAltitudeReply { ap, .. } => Some(ap.to_string()),
        CommBIdentityReply { ap, .. } => Some(ap.to_string()),
        _ => None,
    }
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

    pub fn search(&self, query: &str) -> Vec<SearchResult> {
        let candidates: Vec<&StateVector> = self.aircraft.values().collect();

        let haystacks: Vec<String> = candidates
            .iter()
            .map(|sv| {
                format!(
                    "{} {} {}",
                    sv.icao24,
                    sv.callsign.as_deref().unwrap_or(""),
                    sv.registration.as_deref().unwrap_or("")
                )
            })
            .collect();

        if haystacks.is_empty() {
            return vec![];
        }

        let mut matcher = Matcher::new(Config::DEFAULT);
        let pattern = Pattern::parse(query, CaseMatching::Ignore, Normalization::Smart);

        let mut matches: Vec<(u32, usize)> = haystacks
            .iter()
            .enumerate()
            .filter_map(|(idx, haystack)| {
                let mut buf = Vec::new();
                pattern
                    .score(Utf32Str::new(haystack, &mut buf), &mut matcher)
                    .map(|score| (score, idx))
            })
            .collect();

        matches.sort_by(|a, b| b.0.cmp(&a.0));

        matches
            .into_iter()
            .take(10)
            .filter(|(score, _)| *score > 20)
            .map(|(score, idx)| {
                let sv = candidates[idx];
                SearchResult {
                    state: sv.clone(),
                    score,
                }
            })
            .collect()
    }

    pub async fn add(&mut self, msg: &TimedMessage) -> Result<()> {
        let message = if let Some(m) = &msg.message {
            m
        } else {
            return Ok(());
        };

        if let Some(icao24) = icao24(message) {
            let sv = self.aircraft.entry(icao24.clone()).or_insert_with(|| {
                let mut registration = match aircraft_information(&icao24, None) {
                    Ok(aircraft_info) => aircraft_info.registration.clone(),
                    Err(_) => None,
                };

                let mut typecode = None;

                if let Some(aircraft) = self.aircraft_db.get(&icao24) {
                    typecode = aircraft.typecode.clone();
                    registration = aircraft.registration.clone();
                }
                StateVector {
                    icao24: icao24.clone(),
                    firstseen: 0,
                    lastseen: (msg.timestamp * 1_000_000.0) as u64,
                    callsign: None,
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

            match &message.df {
                SurveillanceIdentityReply { id, .. } => {
                    sv.squawk = Some(id.0);
                }
                SurveillanceAltitudeReply { ac, .. } => {
                    sv.altitude = ac.0;
                }
                ExtendedSquitterADSB(adsb) => match &adsb.message {
                    ME::BDS05 { inner: bds05, .. } => {
                        sv.latitude = bds05.latitude;
                        sv.longitude = bds05.longitude;
                        sv.altitude = bds05.alt;
                    }
                    ME::BDS06 { inner: bds06, .. } => {
                        sv.latitude = bds06.latitude;
                        sv.longitude = bds06.longitude;
                        sv.track = bds06.track;
                        sv.groundspeed = bds06.groundspeed;
                        sv.altitude = None;
                    }
                    ME::BDS08 { inner: bds08, .. } => {
                        if !bds08.callsign.contains("#") {
                            sv.callsign = Some(bds08.callsign.to_string())
                        }
                    }
                    ME::BDS09(bds09) => {
                        sv.vertical_rate = bds09.vertical_rate;
                        match &bds09.velocity {
                            GroundSpeedDecoding(spd) => {
                                sv.groundspeed = Some(spd.groundspeed);
                                sv.track = Some(spd.track)
                            }
                            AirspeedSubsonic(spd) => {
                                match spd.airspeed_type {
                                    IAS => sv.ias = spd.airspeed,
                                    TAS => sv.tas = spd.airspeed,
                                }
                                sv.heading = spd.heading;
                            }
                            _ => {}
                        }
                    }
                    ME::BDS61(bds61) => {
                        sv.squawk = Some(bds61.squawk.0);
                    }
                    ME::BDS62(bds62) => {
                        sv.selected_altitude = bds62.selected_altitude;
                        sv.nacp = Some(bds62.nac_p);
                    }
                    ME::BDS65(bds65) => match bds65 {
                        AircraftOperationStatus::Airborne(st) => match st.version {
                            ADSBVersionAirborne::DOC9871AppendixB(v) => sv.nacp = Some(v.nac_p),
                            ADSBVersionAirborne::DOC9871AppendixC(v) => sv.nacp = Some(v.nac_p),
                            _ => {}
                        },
                        AircraftOperationStatus::Surface(st) => match st.version {
                            ADSBVersionSurface::DOC9871AppendixB(v) => sv.nacp = Some(v.nac_p),
                            ADSBVersionSurface::DOC9871AppendixC(v) => sv.nacp = Some(v.nac_p),
                            _ => {}
                        },
                        _ => {}
                    },
                    _ => {}
                },
                ExtendedSquitterTisB { cf, .. } => {
                    sv.typecode = Some("GRND".to_string());
                    match &cf.me {
                        ME::BDS05 { inner: bds05, .. } => {
                            sv.latitude = bds05.latitude;
                            sv.longitude = bds05.longitude;
                            sv.altitude = bds05.alt;
                        }
                        ME::BDS06 { inner: bds06, .. } => {
                            sv.latitude = bds06.latitude;
                            sv.longitude = bds06.longitude;
                            sv.track = bds06.track;
                            sv.groundspeed = bds06.groundspeed;
                            sv.altitude = None;
                        }
                        ME::BDS08 { inner: bds08, .. } => {
                            sv.callsign = Some(bds08.callsign.to_string())
                        }
                        _ => {}
                    }
                }
                CommBAltitudeReply { bds, .. } => {
                    if let Some(bds20) = &bds.bds20 {
                        if !bds20.callsign.contains("#") {
                            sv.callsign = Some(bds20.callsign.to_string());
                        }
                    }
                    if let Some(bds40) = &bds.bds40 {
                        sv.selected_altitude = bds40.selected_altitude_mcp;
                    }
                    if let Some(bds50) = &bds.bds50 {
                        sv.roll = bds50.roll_angle;
                        sv.track = bds50.track_angle;
                        sv.groundspeed = bds50.groundspeed.map(|x| x as f64);
                        sv.tas = bds50.true_airspeed;
                    }
                    if let Some(bds60) = &bds.bds60 {
                        sv.ias = bds60.indicated_airspeed;
                        sv.mach = bds60.mach_number;
                        sv.heading = bds60.magnetic_heading;
                        if bds60.inertial_vertical_velocity.is_some() {
                            sv.vertical_rate = bds60.inertial_vertical_velocity;
                        }
                    }
                }
                CommBIdentityReply { bds, .. } => {
                    if let Some(bds20) = &bds.bds20 {
                        if !bds20.callsign.contains("#") {
                            sv.callsign = Some(bds20.callsign.to_string());
                        }
                    }
                    if let Some(bds40) = &bds.bds40 {
                        sv.selected_altitude = bds40.selected_altitude_mcp;
                    }
                    if let Some(bds50) = &bds.bds50 {
                        sv.roll = bds50.roll_angle;
                        sv.track = bds50.track_angle;
                        sv.groundspeed = bds50.groundspeed.map(|x| x as f64);
                        sv.tas = bds50.true_airspeed;
                    }
                    if let Some(bds60) = &bds.bds60 {
                        sv.ias = bds60.indicated_airspeed;
                        sv.mach = bds60.mach_number;
                        sv.heading = bds60.magnetic_heading;
                        if bds60.inertial_vertical_velocity.is_some() {
                            sv.vertical_rate = bds60.inertial_vertical_velocity;
                        }
                    }
                }
                _ => {}
            };

            let frame = Jet1090HistoryFrame::from(msg);
            if let Some(buffer) = &self.history_buffer {
                buffer.add(frame).await;
            }
        }
        Ok(())
    }
}

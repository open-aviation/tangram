use datalink::acars::decode::avlc::AvlcPayload;
use datalink::acars::decode::payload::arinc620::squitter::{SquitterLink, SquitterMessage};
use datalink::acars::decode::payload::AcarsAppPayload;
use datalink::event::{AirframesAddrType, DecodedEvent, ProtocolMessage};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use tangram_core::stream::{Identifiable, Positioned, StateCollection, Tracked};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatalinkAircraftInfo {
    pub icao24: Option<String>,
    pub registration: Option<String>,
    pub aircraft_id: Option<String>,
    pub flight_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatalinkStationInfo {
    pub station: String,
    pub airport: Option<String>,
    pub hexcode: Option<String>,
    pub link_type: Option<String>,
    pub provider: Option<String>,
    pub frequency_mhz: Option<f64>,
    pub supported_frequencies_mhz: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "lowercase")]
pub enum DatalinkEntityDetails {
    Aircraft(DatalinkAircraftInfo),
    Station(DatalinkStationInfo),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatalinkEntity {
    pub id: String,
    pub label: String,
    pub lastseen: f64,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude_ft: Option<i32>,
    pub track: Option<f64>,
    pub messages: usize,
    pub position_time: Option<f64>,
    pub details: DatalinkEntityDetails,
}

impl DatalinkEntity {
    fn aircraft_info(&self) -> Option<&DatalinkAircraftInfo> {
        match &self.details {
            DatalinkEntityDetails::Aircraft(info) => Some(info),
            DatalinkEntityDetails::Station(_) => None,
        }
    }

    fn set_aircraft_info(&mut self, info: DatalinkAircraftInfo) {
        self.details = DatalinkEntityDetails::Aircraft(info);
    }

    fn set_station_info(&mut self, info: DatalinkStationInfo) {
        self.details = DatalinkEntityDetails::Station(info);
    }
}

impl Positioned for DatalinkEntity {
    fn latitude(&self) -> Option<f64> {
        self.latitude
    }
    fn longitude(&self) -> Option<f64> {
        self.longitude
    }
}

impl Identifiable for DatalinkEntity {
    fn id(&self) -> String {
        self.id.clone()
    }
}

impl Tracked for DatalinkEntity {
    fn lastseen(&self) -> u64 {
        self.lastseen as u64
    }
}

pub struct DatalinkStateVectors {
    pub entities: HashMap<String, DatalinkEntity>,
    pub expire: u16,
    pub aliases: HashMap<String, String>,
}

struct AircraftUpdate {
    id: String,
    label: String,
    icao24: Option<String>,
    registration: Option<String>,
    aircraft_id: Option<String>,
    flight_id: Option<String>,
}

struct StationUpdate {
    id: String,
    label: String,
    station: String,
    airport: Option<String>,
    hexcode: Option<String>,
    link_type: Option<String>,
    provider: Option<String>,
    frequency_mhz: Option<f64>,
    supported_frequencies_mhz: Vec<f64>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

impl DatalinkStateVectors {
    pub fn new(expire: u16) -> Self {
        Self {
            entities: HashMap::new(),
            expire,
            aliases: HashMap::new(),
        }
    }

    pub fn resolve_aircraft_id(
        &mut self,
        icao: Option<&str>,
        reg: Option<&str>,
        flt: Option<&str>,
    ) -> Option<String> {
        let final_id = icao
            .or(reg)
            .or(flt)
            .map(|value| self.aliases.get(value).map_or(value, String::as_str))?
            .to_string();

        match (icao, reg, flt) {
            (Some(icao), Some(reg), _) if reg != icao => self.alias(reg, icao),
            _ => {}
        }
        match (icao, flt) {
            (Some(icao), Some(flt)) if flt != icao => self.alias(flt, icao),
            _ => {}
        }
        match (icao, reg, flt) {
            (None, Some(reg), Some(flt)) if flt != reg => self.alias(flt, reg),
            _ => {}
        }

        Some(final_id)
    }

    fn alias(&mut self, from: &str, to: &str) {
        if self.aliases.get(from).is_some_and(|known| known == to) {
            return;
        }
        self.aliases.insert(from.to_string(), to.to_string());
        self.merge_state(from, to);
    }

    fn merge_state(&mut self, from: &str, to: &str) {
        let Some(mut old) = self.entities.remove(from) else {
            return;
        };
        old.id = to.to_string();

        match self.entities.entry(to.to_string()) {
            Entry::Vacant(slot) => {
                slot.insert(old);
            }
            Entry::Occupied(mut slot) => {
                let target = slot.get_mut();
                target.messages += old.messages;
                target.lastseen = target.lastseen.max(old.lastseen);
                if target.latitude.is_none() {
                    target.latitude = old.latitude;
                    target.longitude = old.longitude;
                    target.altitude_ft = old.altitude_ft;
                    target.track = old.track;
                    target.position_time = old.position_time;
                }
            }
        }
    }

    pub fn add(&mut self, env: &DecodedEvent) {
        if let Some(update) = extract_station_update(env) {
            self.add_station(env, update);
            return;
        }
        if let Some(update) = extract_gsif_station_update(env) {
            self.add_station(env, update);
            return;
        }
        if let Some(update) = self.extract_aircraft_update(env) {
            self.add_aircraft(env, update);
        }
    }

    fn extract_aircraft_update(&mut self, env: &DecodedEvent) -> Option<AircraftUpdate> {
        let icao24 = env.aircraft.as_ref().and_then(|a| a.icao24.clone());
        let registration = env.aircraft.as_ref().and_then(|a| a.registration.clone());
        let aircraft_id = env
            .aircraft
            .as_ref()
            .and_then(|a| a.aircraft_id.map(|id| id.to_string()));
        let flight_id = if let ProtocolMessage::Airframes(airframes) = &env.message {
            airframes.payload.flight_id.map(|id| id.to_string())
        } else {
            None
        };

        let id = self.resolve_aircraft_id(
            icao24.as_deref(),
            registration.as_deref(),
            flight_id.as_deref().or(aircraft_id.as_deref()),
        )?;

        let label = flight_id
            .clone()
            .or_else(|| registration.clone())
            .or_else(|| icao24.clone())
            .or_else(|| aircraft_id.clone())
            .unwrap_or_else(|| "Unknown aircraft".into());

        Some(AircraftUpdate {
            id,
            label,
            icao24,
            registration,
            aircraft_id,
            flight_id,
        })
    }

    fn add_aircraft(&mut self, env: &DecodedEvent, update: AircraftUpdate) {
        let ac = self
            .entities
            .entry(update.id.clone())
            .or_insert_with(|| DatalinkEntity {
                id: update.id.clone(),
                label: update.label.clone(),
                lastseen: 0.0,
                latitude: None,
                longitude: None,
                altitude_ft: None,
                track: None,
                messages: 0,
                position_time: None,
                details: DatalinkEntityDetails::Aircraft(DatalinkAircraftInfo {
                    icao24: update.icao24.clone(),
                    registration: update.registration.clone(),
                    aircraft_id: update.aircraft_id.clone(),
                    flight_id: update.flight_id.clone(),
                }),
            });

        let current = ac.aircraft_info().cloned();
        ac.label = update.label;
        ac.set_aircraft_info(DatalinkAircraftInfo {
            icao24: current
                .as_ref()
                .and_then(|a| a.icao24.clone())
                .or(update.icao24),
            registration: current
                .as_ref()
                .and_then(|a| a.registration.clone())
                .or(update.registration),
            aircraft_id: current
                .as_ref()
                .and_then(|a| a.aircraft_id.clone())
                .or(update.aircraft_id),
            flight_id: current
                .as_ref()
                .and_then(|a| a.flight_id.clone())
                .or(update.flight_id),
        });
        apply_kinematics(ac, env, self.expire);
    }

    fn add_station(&mut self, env: &DecodedEvent, update: StationUpdate) {
        let station = self
            .entities
            .entry(update.id.clone())
            .or_insert_with(|| DatalinkEntity {
                id: update.id.clone(),
                label: update.label.clone(),
                lastseen: 0.0,
                latitude: None,
                longitude: None,
                altitude_ft: None,
                track: None,
                messages: 0,
                position_time: None,
                details: DatalinkEntityDetails::Station(DatalinkStationInfo {
                    station: update.station.clone(),
                    airport: update.airport.clone(),
                    hexcode: update.hexcode.clone(),
                    link_type: update.link_type.clone(),
                    provider: update.provider.clone(),
                    frequency_mhz: update.frequency_mhz,
                    supported_frequencies_mhz: update.supported_frequencies_mhz.clone(),
                }),
            });

        station.label = update.label;
        station.set_station_info(DatalinkStationInfo {
            station: update.station,
            airport: update.airport,
            hexcode: update.hexcode,
            link_type: update.link_type,
            provider: update.provider,
            frequency_mhz: update.frequency_mhz,
            supported_frequencies_mhz: update.supported_frequencies_mhz,
        });
        if let Some(ts) = env.timestamp {
            station.lastseen = station.lastseen.max(ts);
        }
        station.messages += 1;
        if let (Some(latitude), Some(longitude)) = (update.latitude, update.longitude) {
            station.latitude = Some(latitude);
            station.longitude = Some(longitude);
            if let Some(ts) = env.timestamp {
                station.position_time = Some(ts);
            }
        }
    }
}

fn apply_kinematics(entity: &mut DatalinkEntity, env: &DecodedEvent, expire: u16) {
    if let Some(ts) = env.timestamp {
        entity.lastseen = entity.lastseen.max(ts);
    }
    entity.messages += 1;

    if let Some(pos) = &env.kinematics {
        if let Some(position) = pos.position {
            entity.latitude = Some(position.latitude);
            entity.longitude = Some(position.longitude);
            if let Some(ts) = env.timestamp {
                entity.position_time = Some(ts);
            }
        }
        if pos.altitude_ft.is_some() {
            entity.altitude_ft = pos.altitude_ft;
        }
        if pos.track.is_some() {
            entity.track = pos.track;
        }
    }

    if let Some(pt) = entity.position_time {
        if entity.lastseen - pt > expire as f64 {
            entity.latitude = None;
            entity.longitude = None;
            entity.altitude_ft = None;
            entity.track = None;
        }
    }
}

fn extract_station_update(env: &DecodedEvent) -> Option<StationUpdate> {
    let squitter = squitter_payload(&env.message)?;
    let station_value = squitter.station.clone();
    let airport = squitter.airport.clone();
    let station = station_value.clone().or_else(|| airport.clone())?;
    let hexcode = ground_station_hexcode(&env.message);
    let link_type = squitter.link.map(squitter_link_type);
    let provider = squitter.provider.clone();
    let frequency_mhz = squitter.frequency_mhz;

    let (latitude, longitude) = env
        .kinematics
        .as_ref()
        .and_then(|k| k.position.map(|p| (Some(p.latitude), Some(p.longitude))))
        .unwrap_or((squitter.latitude, squitter.longitude));

    let id = station.clone();
    let label = station_value
        .clone()
        .or_else(|| airport.clone())
        .unwrap_or_else(|| "Unknown station".into());

    Some(StationUpdate {
        id,
        label,
        station,
        airport,
        hexcode,
        link_type,
        provider,
        frequency_mhz,
        supported_frequencies_mhz: Vec::new(),
        latitude,
        longitude,
    })
}

fn extract_gsif_station_update(env: &DecodedEvent) -> Option<StationUpdate> {
    let ProtocolMessage::Avlc(frame) = &env.message else {
        return None;
    };
    let Some(AvlcPayload::Xid(xid)) = frame.payload.as_ref() else {
        return None;
    };
    (xid.xid_type == "GSIF").then_some(())?;

    let hexcode = ground_station_hexcode(&env.message)?;
    let airport = xid.vdl_params.airport_coverage.clone();
    let latitude = xid
        .vdl_params
        .gs_location
        .as_ref()
        .map(|location| location.lat as f64);
    let longitude = xid
        .vdl_params
        .gs_location
        .as_ref()
        .map(|location| location.lon as f64);
    let supported_frequencies_mhz = xid
        .vdl_params
        .freq_support_list
        .iter()
        .map(|freq| freq.freq_mhz as f64)
        .fold(Vec::new(), push_unique_frequency);
    let frequency_mhz = env
        .receiver
        .as_ref()
        .and_then(|r| r.channel_hz)
        .map(|hz| hz as f64 / 1_000_000.0)
        .or_else(|| supported_frequencies_mhz.first().copied());

    Some(StationUpdate {
        id: hexcode.clone(),
        label: hexcode.clone(),
        station: hexcode.clone(),
        airport,
        hexcode: Some(hexcode),
        link_type: Some("VDL2".into()),
        provider: None,
        frequency_mhz,
        supported_frequencies_mhz,
        latitude,
        longitude,
    })
}

fn push_unique_frequency(mut frequencies: Vec<f64>, freq: f64) -> Vec<f64> {
    if !frequencies
        .iter()
        .any(|existing| (*existing - freq).abs() < 0.0005)
    {
        frequencies.push(freq);
    }
    frequencies
}

fn squitter_payload(message: &ProtocolMessage) -> Option<&SquitterMessage> {
    match message {
        ProtocolMessage::App(app) => squitter_from_app(app),
        ProtocolMessage::Acars(acars) => squitter_from_app(&acars.app),
        ProtocolMessage::Avlc(frame) => match frame.payload.as_ref()? {
            AvlcPayload::Acars(acars) => squitter_from_app(&acars.app),
            _ => None,
        },
        ProtocolMessage::Airframes(airframes) => airframes.app.as_ref().and_then(squitter_from_app),
        ProtocolMessage::Hfdl(_) => None,
    }
}

fn squitter_from_app(app: &AcarsAppPayload) -> Option<&SquitterMessage> {
    match app {
        AcarsAppPayload::Squitter(squitter) => Some(squitter),
        _ => None,
    }
}

fn ground_station_hexcode(message: &ProtocolMessage) -> Option<String> {
    match message {
        ProtocolMessage::Avlc(frame) => [&frame.src, &frame.dst]
            .into_iter()
            .find(|addr| addr.is_ground())
            .map(|addr| format!("{:06x}", addr.icao24)),
        ProtocolMessage::Airframes(airframes) => [airframes.src.as_ref(), airframes.dst.as_ref()]
            .into_iter()
            .flatten()
            .find(|addr| addr.addr_type == AirframesAddrType::GroundStation)
            .map(|addr| addr.icao24.to_ascii_lowercase()),
        ProtocolMessage::Acars(_) | ProtocolMessage::App(_) | ProtocolMessage::Hfdl(_) => None,
    }
}

fn squitter_link_type(link: SquitterLink) -> String {
    match link {
        SquitterLink::Vhf => "VHF".into(),
        SquitterLink::Satellite => "SAT".into(),
        SquitterLink::Other(value) => value.to_string(),
    }
}

impl StateCollection for DatalinkStateVectors {
    type Item = DatalinkEntity;
    fn get_all(&self) -> Vec<Self::Item> {
        self.entities.values().cloned().collect()
    }
    fn state_vector_expire_secs(&self) -> u64 {
        self.expire as u64
    }
}

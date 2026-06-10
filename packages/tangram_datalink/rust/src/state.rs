use acars::decode::compact::Kinematics;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tangram_core::stream::{Identifiable, Positioned, StateCollection, Tracked};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aircraft {
    #[serde(default, deserialize_with = "deserialize_optional_id")]
    pub icao24: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_id")]
    pub registration: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_id")]
    pub aircraft_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceMetadata {
    pub id: String,
    pub name: Option<String>,
    #[serde(rename = "class")]
    pub class_name: Option<String>,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiverMetadata {
    pub bearer: Option<String>,
    pub channel_hz: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodedEvent {
    pub timestamp: Option<f64>,
    pub aircraft: Option<Aircraft>,
    pub kinematics: Option<Kinematics>,
    #[serde(default, deserialize_with = "deserialize_optional_id")]
    pub flight_id: Option<String>,
    pub source: Option<SourceMetadata>,
    pub receiver: Option<ReceiverMetadata>,
    #[serde(flatten)]
    pub message: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatalinkEntityKind {
    Aircraft,
    Station,
}

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
pub struct DatalinkEntity {
    pub kind: DatalinkEntityKind,
    pub id: String,
    pub label: String,
    pub lastseen: f64,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude_ft: Option<i32>,
    pub track: Option<f64>,
    pub messages: usize,
    pub position_time: Option<f64>,
    pub aircraft: Option<DatalinkAircraftInfo>,
    pub station: Option<DatalinkStationInfo>,
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
        let mut best_id = icao.map(String::from);

        if best_id.is_none() {
            if let Some(r) = reg {
                best_id = Some(
                    self.aliases
                        .get(r)
                        .cloned()
                        .unwrap_or_else(|| r.to_string()),
                );
            }
        }

        if best_id.is_none() {
            if let Some(f) = flt {
                best_id = Some(
                    self.aliases
                        .get(f)
                        .cloned()
                        .unwrap_or_else(|| f.to_string()),
                );
            }
        }

        let final_id = best_id?;

        if let Some(i) = icao {
            if let Some(r) = reg {
                if r != i && self.aliases.get(r) != Some(&i.to_string()) {
                    self.aliases.insert(r.to_string(), i.to_string());
                    self.merge_state(r, i);
                }
            }
            if let Some(f) = flt {
                if f != i && self.aliases.get(f) != Some(&i.to_string()) {
                    self.aliases.insert(f.to_string(), i.to_string());
                    self.merge_state(f, i);
                }
            }
        } else if let Some(r) = reg {
            if let Some(f) = flt {
                if f != r && self.aliases.get(f) != Some(&r.to_string()) {
                    self.aliases.insert(f.to_string(), r.to_string());
                    self.merge_state(f, r);
                }
            }
        }

        Some(final_id)
    }

    fn merge_state(&mut self, from: &str, to: &str) {
        if let Some(old) = self.entities.remove(from) {
            let target = self
                .entities
                .entry(to.to_string())
                .or_insert_with(|| old.clone());
            target.messages += old.messages;
            if old.lastseen > target.lastseen {
                target.lastseen = old.lastseen;
            }
            if target.latitude.is_none() {
                target.latitude = old.latitude;
                target.longitude = old.longitude;
                target.altitude_ft = old.altitude_ft;
                target.position_time = old.position_time;
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
        let aircraft_id = env.aircraft.as_ref().and_then(|a| a.aircraft_id.clone());
        let flight_id = env.flight_id.clone();

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
                kind: DatalinkEntityKind::Aircraft,
                id: update.id.clone(),
                label: update.label.clone(),
                lastseen: 0.0,
                latitude: None,
                longitude: None,
                altitude_ft: None,
                track: None,
                messages: 0,
                position_time: None,
                aircraft: Some(DatalinkAircraftInfo {
                    icao24: update.icao24.clone(),
                    registration: update.registration.clone(),
                    aircraft_id: update.aircraft_id.clone(),
                    flight_id: update.flight_id.clone(),
                }),
                station: None,
            });

        ac.kind = DatalinkEntityKind::Aircraft;
        ac.label = update.label;
        ac.aircraft = Some(DatalinkAircraftInfo {
            icao24: ac
                .aircraft
                .as_ref()
                .and_then(|a| a.icao24.clone())
                .or(update.icao24),
            registration: ac
                .aircraft
                .as_ref()
                .and_then(|a| a.registration.clone())
                .or(update.registration),
            aircraft_id: ac
                .aircraft
                .as_ref()
                .and_then(|a| a.aircraft_id.clone())
                .or(update.aircraft_id),
            flight_id: ac
                .aircraft
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
                kind: DatalinkEntityKind::Station,
                id: update.id.clone(),
                label: update.label.clone(),
                lastseen: 0.0,
                latitude: None,
                longitude: None,
                altitude_ft: None,
                track: None,
                messages: 0,
                position_time: None,
                aircraft: None,
                station: Some(DatalinkStationInfo {
                    station: update.station.clone(),
                    airport: update.airport.clone(),
                    hexcode: update.hexcode.clone(),
                    link_type: update.link_type.clone(),
                    provider: update.provider.clone(),
                    frequency_mhz: update.frequency_mhz,
                    supported_frequencies_mhz: update.supported_frequencies_mhz.clone(),
                }),
            });

        station.kind = DatalinkEntityKind::Station;
        station.label = update.label;
        station.station = Some(DatalinkStationInfo {
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
    let squitter = squitter_payload(env)?;
    let station_value = string_field(squitter, &["station"]);
    let airport = string_field(squitter, &["airport"]);
    let station = station_value.clone().or_else(|| airport.clone())?;
    let hexcode = ground_station_hexcode(env);
    let link_type = squitter_link_type(squitter);
    let provider = string_field(squitter, &["provider"]);
    let frequency_mhz = number_field(squitter, &["frequency_mhz"]);

    let (latitude, longitude) = env
        .kinematics
        .as_ref()
        .and_then(|k| k.position.map(|p| (Some(p.latitude), Some(p.longitude))))
        .unwrap_or_else(|| {
            (
                number_field(squitter, &["latitude", "lat"]),
                number_field(squitter, &["longitude", "lon"]),
            )
        });

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
    let xid = env.message.get("Xid")?;
    (xid.get("xid_type").and_then(Value::as_str) == Some("GSIF")).then_some(())?;
    let vdl_params = xid.get("vdl_params")?;
    let hexcode = ground_station_hexcode(env)?;
    let airport = string_field(vdl_params, &["airport_coverage"]);
    let location = vdl_params.get("gs_location");
    let latitude = location.and_then(|v| number_field(v, &["lat", "latitude"]));
    let longitude = location.and_then(|v| number_field(v, &["lon", "longitude"]));
    let supported_frequencies_mhz = supported_frequencies(vdl_params);
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

fn supported_frequencies(vdl_params: &Value) -> Vec<f64> {
    let Some(values) = vdl_params
        .get("freq_support_list")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let mut frequencies = Vec::new();
    for value in values {
        if let Some(freq) = number_field(value, &["freq_mhz"]) {
            if !frequencies
                .iter()
                .any(|existing: &f64| (*existing - freq).abs() < 0.0005)
            {
                frequencies.push(freq);
            }
        }
    }
    frequencies
}

fn ground_station_hexcode(env: &DecodedEvent) -> Option<String> {
    ["src", "dst"].iter().find_map(|key| {
        let addr = env.message.get(*key)?;
        (addr.get("type").and_then(Value::as_str) == Some("ground_station"))
            .then(|| addr.get("icao24").and_then(Value::as_str))
            .flatten()
            .map(|s| s.to_ascii_lowercase())
    })
}

fn squitter_payload(env: &DecodedEvent) -> Option<&Value> {
    for key in ["Squitter", "SQ"] {
        if let Some(value) = env.message.get(key) {
            return Some(value);
        }
    }

    if let Some(app) = env.message.get("app") {
        if let Some(value) = app.get("Squitter").or_else(|| app.get("SQ")) {
            return Some(value);
        }
        if app.get("station").is_some() && app.get("airport").is_some() {
            return Some(app);
        }
    }

    None
}

fn squitter_link_type(value: &Value) -> Option<String> {
    let link = value.get("link")?;
    match link {
        Value::String(value) => match value.as_str() {
            "Vhf" | "VHF" => Some("VHF".into()),
            "Satellite" | "SAT" => Some("SAT".into()),
            other if !other.trim().is_empty() => Some(other.trim().to_string()),
            _ => None,
        },
        Value::Object(map) => map
            .get("Other")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string()),
        _ => None,
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn number_field(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
        })
    })
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

// TODO figure out a better way to do this
fn deserialize_optional_id<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(match value {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(value)) if value.trim().is_empty() => None,
        Some(serde_json::Value::String(value)) => Some(value.trim().to_string()),
        Some(serde_json::Value::Number(value)) => Some(value.to_string()),
        Some(serde_json::Value::Bool(value)) => Some(value.to_string()),
        Some(other) => Some(other.to_string()),
    })
}

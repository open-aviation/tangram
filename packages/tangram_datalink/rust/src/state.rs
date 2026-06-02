use crate::message::DatalinkMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tangram_core::stream::{Identifiable, Positioned, StateCollection, Tracked};

#[derive(Debug, Clone, Serialize, Deserialize)]
// we should add groundspeed, vertical_rate, heading, ias, tas, mach, wind, temperature
// origin, destination etc. but we don't observe it from airframes yet
// so we hold it off for now
pub struct DatalinkAircraft {
    pub icao24: Option<String>,
    pub registration: Option<String>,
    pub flight_id: Option<String>,
    pub lastseen: f64,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude_ft: Option<i32>,
    pub track: Option<f64>,
    pub messages: usize,
    pub position_time: Option<f64>,
}

impl Positioned for DatalinkAircraft {
    fn latitude(&self) -> Option<f64> {
        self.latitude
    }
    fn longitude(&self) -> Option<f64> {
        self.longitude
    }
}

impl Identifiable for DatalinkAircraft {
    fn id(&self) -> String {
        self.icao24
            .clone()
            .or_else(|| self.registration.clone())
            .or_else(|| self.flight_id.clone())
            .unwrap_or_else(|| "unknown".into()) // TODO: discard it instead?
    }
}

impl Tracked for DatalinkAircraft {
    fn lastseen(&self) -> u64 {
        self.lastseen as u64
    }
}

pub struct DatalinkStateVectors {
    pub aircraft: HashMap<String, DatalinkAircraft>,
    pub expire: u16,
    pub aliases: HashMap<String, String>, // TODO: expire old aliases
}

impl DatalinkStateVectors {
    pub fn new(expire: u16) -> Self {
        Self {
            aircraft: HashMap::new(),
            expire,
            aliases: HashMap::new(),
        }
    }

    pub fn resolve_id(
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
        if let Some(old) = self.aircraft.remove(from) {
            let target = self
                .aircraft
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

    pub fn add(&mut self, env: &DatalinkMessage) {
        let icao24 = env.icao24.as_deref();
        let reg = env.registration.as_deref();
        let flt = env.flight_id.as_deref();

        let key = self.resolve_id(icao24, reg, flt);

        if let Some(id) = key {
            let ac = self.aircraft.entry(id).or_insert_with(|| DatalinkAircraft {
                icao24: icao24.map(String::from),
                registration: reg.map(String::from),
                flight_id: flt.map(String::from),
                lastseen: 0.0,
                latitude: None,
                longitude: None,
                altitude_ft: None,
                track: None,
                messages: 0,
                position_time: None,
            });

            ac.lastseen = ac.lastseen.max(env.timestamp);
            ac.messages += 1;

            if ac.flight_id.is_none() && flt.is_some() {
                ac.flight_id = flt.map(String::from);
            }
            if ac.icao24.is_none() && icao24.is_some() {
                ac.icao24 = icao24.map(String::from);
            }
            if ac.registration.is_none() && reg.is_some() {
                ac.registration = reg.map(String::from);
            }

            if let Some(pos) = &env.kinematics {
                if pos.latitude.is_some() && pos.longitude.is_some() {
                    ac.latitude = pos.latitude;
                    ac.longitude = pos.longitude;
                    ac.position_time = Some(env.timestamp);
                }
                if pos.altitude_ft.is_some() {
                    ac.altitude_ft = pos.altitude_ft;
                }
                if pos.track.is_some() {
                    ac.track = pos.track;
                }
            }

            if let Some(pt) = ac.position_time {
                if ac.lastseen - pt > self.expire as f64 {
                    ac.latitude = None;
                    ac.longitude = None;
                    ac.altitude_ft = None;
                    ac.track = None;
                }
            }
        }
    }
}

impl StateCollection for DatalinkStateVectors {
    type Item = DatalinkAircraft;
    fn get_all(&self) -> Vec<Self::Item> {
        self.aircraft.values().cloned().collect()
    }
    fn state_vector_expire_secs(&self) -> u64 {
        self.expire as u64
    }
}

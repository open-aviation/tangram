use anyhow::Result;
use rs162::prelude::{Message, MmsiInfo, NavigationStatus, ShipType, StaticDataReport};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tangram_core::stream::{Positioned, StateCollection, Tracked};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipStateVector {
    pub mmsi: u32,
    pub lastseen: u64,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub ship_name: Option<String>,
    pub course: Option<f32>,
    pub heading: Option<u16>,
    pub speed: Option<f32>,
    pub ship_type: Option<ShipType>,
    pub callsign: Option<String>,
    pub destination: Option<String>,
    pub status: Option<NavigationStatus>,
    pub mmsi_info: Option<MmsiInfo>,
    pub imo: Option<u32>,
    pub draught: Option<f32>,
    pub to_bow: Option<u16>,
    pub to_stern: Option<u16>,
    pub to_port: Option<u8>,
    pub to_starboard: Option<u8>,
    pub turn: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TimedMessage {
    pub timestamp: u64,
    #[serde(flatten)]
    pub message: Message,
    #[serde(flatten)]
    pub mmsi_info: Option<MmsiInfo>,
}

pub struct ShipStateVectors {
    pub ships: HashMap<u32, ShipStateVector>,
    pub history_expire: u16,
}

impl ShipStateVectors {
    pub fn new(expire: u16) -> Self {
        info!("initializing ship state");
        Self {
            ships: HashMap::new(),
            history_expire: expire,
        }
    }

    pub fn add(&mut self, sentence: &TimedMessage) {
        let message = &sentence.message;
        let mmsi = message.mmsi();

        let vessel = self.ships.entry(mmsi).or_insert_with(|| ShipStateVector {
            mmsi,
            lastseen: 0,
            latitude: None,
            longitude: None,
            ship_name: None,
            course: None,
            heading: None,
            speed: None,
            ship_type: None,
            callsign: None,
            destination: None,
            status: None,
            mmsi_info: sentence.mmsi_info.clone(),
            imo: None,
            draught: None,
            to_bow: None,
            to_stern: None,
            to_port: None,
            to_starboard: None,
            turn: None,
        });

        vessel.lastseen = sentence.timestamp;
        if vessel.mmsi_info.is_none() {
            vessel.mmsi_info = sentence.mmsi_info.clone();
        }

        match message {
            Message::PositionReport1(msg)
            | Message::PositionReport2(msg)
            | Message::PositionReport3(msg) => {
                vessel.latitude = msg.latitude;
                vessel.longitude = msg.longitude;
                vessel.speed = msg.speed;
                vessel.course = msg.course;
                vessel.heading = msg.heading;
                vessel.status = Some(msg.status);
                vessel.turn = msg.turn;
            }
            Message::StaticAndVoyageData(msg) => {
                vessel.destination = Some(msg.destination.clone());
                vessel.ship_name = Some(msg.shipname.clone());
                vessel.callsign = Some(msg.callsign.clone());
                vessel.ship_type = Some(msg.ship_type);
                vessel.imo = msg.imo;
                vessel.draught = msg.draught;
                vessel.to_bow = Some(msg.to_bow);
                vessel.to_stern = Some(msg.to_stern);
                vessel.to_port = Some(msg.to_port);
                vessel.to_starboard = Some(msg.to_starboard);
            }
            Message::ClassBPositionReport(msg) => {
                vessel.latitude = msg.latitude;
                vessel.longitude = msg.longitude;
                vessel.speed = msg.speed;
                vessel.course = msg.course;
                vessel.heading = msg.heading;
            }
            Message::ExtendedClassBPositionReport(msg) => {
                vessel.latitude = msg.latitude;
                vessel.longitude = msg.longitude;
                vessel.speed = msg.speed;
                vessel.course = msg.course;
                vessel.heading = msg.heading;
                vessel.ship_name = Some(msg.shipname.clone());
                vessel.ship_type = Some(msg.ship_type);
                vessel.to_bow = Some(msg.to_bow);
                vessel.to_stern = Some(msg.to_stern);
                vessel.to_port = Some(msg.to_port);
                vessel.to_starboard = Some(msg.to_starboard);
            }
            Message::StaticDataReport(StaticDataReport::PartA(msg)) => {
                vessel.ship_name = Some(msg.shipname.clone());
            }
            Message::StaticDataReport(StaticDataReport::PartB(msg)) => {
                vessel.ship_type = Some(msg.ship_type);
                vessel.callsign = Some(msg.callsign.clone());
                vessel.to_bow = Some(msg.to_bow);
                vessel.to_stern = Some(msg.to_stern);
                vessel.to_port = Some(msg.to_port);
                vessel.to_starboard = Some(msg.to_starboard);
            }
            Message::LongRangeAisBroadcastMessage(msg) => {
                vessel.latitude = msg.latitude;
                vessel.longitude = msg.longitude;
                vessel.speed = msg.speed.map(|s| s as f32);
                vessel.course = msg.course.map(|c| c as f32);
            }
            _ => {}
        }
    }
}

impl Positioned for ShipStateVector {
    fn latitude(&self) -> Option<f64> {
        self.latitude
    }
    fn longitude(&self) -> Option<f64> {
        self.longitude
    }
}

impl Tracked for ShipStateVector {
    fn lastseen(&self) -> u64 {
        self.lastseen
    }
}

impl StateCollection for ShipStateVectors {
    type Item = ShipStateVector;
    fn get_all(&self) -> Vec<Self::Item> {
        self.ships.values().cloned().collect()
    }
    fn history_expire_secs(&self) -> u64 {
        self.history_expire as u64
    }
}
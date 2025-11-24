use anyhow::Result;
use arrow_array::{
    ArrayRef, Float32Array, Float64Array, Int16Array, Int32Array, Int64Array, RecordBatch,
    StringArray, TimestampMicrosecondArray,
};
use arrow_schema::{DataType as ArrowDataType, Field, Schema as ArrowSchema, TimeUnit};
use rs162::prelude::{Message, MmsiInfo, NavigationStatus, ShipType, StaticDataReport};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tangram_core::stream::{Identifiable, Positioned, StateCollection, Tracked};
use tangram_history::client::{HistoryBuffer, HistoryFrame};
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
    pub state_vector_expire: u16,
    history_buffer: Option<HistoryBuffer<ShipHistoryFrame>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipHistoryFrame {
    pub mmsi: u32,
    pub timestamp: u64, // in microseconds
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
    pub imo: Option<u32>,
    pub draught: Option<f32>,
    pub to_bow: Option<u16>,
    pub to_stern: Option<u16>,
    pub to_port: Option<u8>,
    pub to_starboard: Option<u8>,
    pub turn: Option<f32>,
}

impl From<&TimedMessage> for ShipHistoryFrame {
    fn from(sentence: &TimedMessage) -> Self {
        let message = &sentence.message;
        let mut frame = ShipHistoryFrame {
            mmsi: message.mmsi(),
            timestamp: sentence.timestamp * 1_000_000,
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
            imo: None,
            draught: None,
            to_bow: None,
            to_stern: None,
            to_port: None,
            to_starboard: None,
            turn: None,
        };

        match message {
            Message::PositionReport1(msg)
            | Message::PositionReport2(msg)
            | Message::PositionReport3(msg) => {
                frame.latitude = msg.latitude;
                frame.longitude = msg.longitude;
                frame.speed = msg.speed;
                frame.course = msg.course;
                frame.heading = msg.heading;
                frame.status = Some(msg.status);
                frame.turn = msg.turn;
            }
            Message::StaticAndVoyageData(msg) => {
                frame.destination = Some(msg.destination.clone());
                frame.ship_name = Some(msg.shipname.clone());
                frame.callsign = Some(msg.callsign.clone());
                frame.ship_type = Some(msg.ship_type);
                frame.imo = msg.imo;
                frame.draught = msg.draught;
                frame.to_bow = Some(msg.to_bow);
                frame.to_stern = Some(msg.to_stern);
                frame.to_port = Some(msg.to_port);
                frame.to_starboard = Some(msg.to_starboard);
            }
            Message::ClassBPositionReport(msg) => {
                frame.latitude = msg.latitude;
                frame.longitude = msg.longitude;
                frame.speed = msg.speed;
                frame.course = msg.course;
                frame.heading = msg.heading;
            }
            Message::ExtendedClassBPositionReport(msg) => {
                frame.latitude = msg.latitude;
                frame.longitude = msg.longitude;
                frame.speed = msg.speed;
                frame.course = msg.course;
                frame.heading = msg.heading;
                frame.ship_name = Some(msg.shipname.clone());
                frame.ship_type = Some(msg.ship_type);
                frame.to_bow = Some(msg.to_bow);
                frame.to_stern = Some(msg.to_stern);
                frame.to_port = Some(msg.to_port);
                frame.to_starboard = Some(msg.to_starboard);
            }
            Message::StaticDataReport(StaticDataReport::PartA(msg)) => {
                frame.ship_name = Some(msg.shipname.clone());
            }
            Message::StaticDataReport(StaticDataReport::PartB(msg)) => {
                frame.ship_type = Some(msg.ship_type);
                frame.callsign = Some(msg.callsign.clone());
                frame.to_bow = Some(msg.to_bow);
                frame.to_stern = Some(msg.to_stern);
                frame.to_port = Some(msg.to_port);
                frame.to_starboard = Some(msg.to_starboard);
            }
            Message::LongRangeAisBroadcastMessage(msg) => {
                frame.latitude = msg.latitude;
                frame.longitude = msg.longitude;
                frame.speed = msg.speed.map(|s| s as f32);
                frame.course = msg.course.map(|c| c as f32);
            }
            _ => {}
        }

        frame
    }
}

impl HistoryFrame for ShipHistoryFrame {
    fn table_schema() -> Arc<ArrowSchema> {
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

    fn to_record_batch(frames: &[&Self]) -> Result<RecordBatch> {
        let schema = Self::data_schema();
        let columns: Vec<ArrayRef> = vec![
            Arc::new(Int64Array::from_iter_values(
                frames.iter().map(|f| f.mmsi as i64),
            )),
            Arc::new(TimestampMicrosecondArray::from_iter_values(
                frames.iter().map(|f| f.timestamp as i64),
            )),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.latitude))),
            Arc::new(Float64Array::from_iter(frames.iter().map(|f| f.longitude))),
            Arc::new(StringArray::from_iter(
                frames.iter().map(|f| f.ship_name.as_ref()),
            )),
            Arc::new(Float32Array::from_iter(frames.iter().map(|f| f.course))),
            Arc::new(Int32Array::from_iter(
                frames.iter().map(|f| f.heading.map(|v| v as i32)),
            )),
            Arc::new(Float32Array::from_iter(frames.iter().map(|f| f.speed))),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.ship_type.map(|v| v as i16)),
            )),
            Arc::new(StringArray::from_iter(
                frames.iter().map(|f| f.callsign.as_ref()),
            )),
            Arc::new(StringArray::from_iter(
                frames.iter().map(|f| f.destination.as_ref()),
            )),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.status.map(|v| v as i16)),
            )),
            Arc::new(Int64Array::from_iter(
                frames.iter().map(|f| f.imo.map(|v| v as i64)),
            )),
            Arc::new(Float32Array::from_iter(frames.iter().map(|f| f.draught))),
            Arc::new(Int32Array::from_iter(
                frames.iter().map(|f| f.to_bow.map(|v| v as i32)),
            )),
            Arc::new(Int32Array::from_iter(
                frames.iter().map(|f| f.to_stern.map(|v| v as i32)),
            )),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.to_port.map(|v| v as i16)),
            )),
            Arc::new(Int16Array::from_iter(
                frames.iter().map(|f| f.to_starboard.map(|v| v as i16)),
            )),
            Arc::new(Float32Array::from_iter(frames.iter().map(|f| f.turn))),
        ];
        Ok(RecordBatch::try_new(schema, columns)?)
    }
}

impl ShipHistoryFrame {
    fn data_schema() -> Arc<ArrowSchema> {
        Arc::new(ArrowSchema::new(Self::data_schema_fields()))
    }

    fn data_schema_fields() -> Vec<Field> {
        vec![
            Field::new("mmsi", ArrowDataType::Int64, false),
            Field::new(
                "timestamp",
                ArrowDataType::Timestamp(TimeUnit::Microsecond, None),
                false,
            ),
            Field::new("latitude", ArrowDataType::Float64, true),
            Field::new("longitude", ArrowDataType::Float64, true),
            Field::new("ship_name", ArrowDataType::Utf8, true),
            Field::new("course", ArrowDataType::Float32, true),
            Field::new("heading", ArrowDataType::Int32, true),
            Field::new("speed", ArrowDataType::Float32, true),
            Field::new("ship_type", ArrowDataType::Int16, true),
            Field::new("callsign", ArrowDataType::Utf8, true),
            Field::new("destination", ArrowDataType::Utf8, true),
            Field::new("status", ArrowDataType::Int16, true),
            Field::new("imo", ArrowDataType::Int64, true),
            Field::new("draught", ArrowDataType::Float32, true),
            Field::new("to_bow", ArrowDataType::Int32, true),
            Field::new("to_stern", ArrowDataType::Int32, true),
            Field::new("to_port", ArrowDataType::Int16, true),
            Field::new("to_starboard", ArrowDataType::Int16, true),
            Field::new("turn", ArrowDataType::Float32, true),
        ]
    }
}

impl ShipStateVectors {
    pub fn new(expire: u16, history_buffer: Option<HistoryBuffer<ShipHistoryFrame>>) -> Self {
        info!("initializing ship state");
        Self {
            ships: HashMap::new(),
            state_vector_expire: expire,
            history_buffer,
        }
    }

    pub fn set_history_buffer(&mut self, buffer: HistoryBuffer<ShipHistoryFrame>) {
        self.history_buffer = Some(buffer);
    }

    pub async fn add(&mut self, sentence: &TimedMessage) {
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

        let frame = ShipHistoryFrame::from(sentence);
        if let Some(buffer) = &self.history_buffer {
            buffer.add(frame).await;
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

impl Identifiable for ShipStateVector {
    fn id(&self) -> String {
        self.mmsi.to_string()
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
    fn state_vector_expire_secs(&self) -> u64 {
        self.state_vector_expire as u64
    }
}

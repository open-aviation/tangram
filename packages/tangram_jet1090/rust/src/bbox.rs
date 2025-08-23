use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tracing::info;

use crate::state::StateVector;

// Struct for bounding box data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub north_east_lat: f64,
    pub north_east_lng: f64,
    pub south_west_lat: f64,
    pub south_west_lng: f64,
}

// Bounding box message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBoxMessage {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    #[serde(rename = "northEastLat")]
    pub north_east_lat: f64,
    #[serde(rename = "northEastLng")]
    pub north_east_lng: f64,
    #[serde(rename = "southWestLat")]
    pub south_west_lat: f64,
    #[serde(rename = "southWestLng")]
    pub south_west_lng: f64,
}

// State to track client connections and their bounding boxes
pub struct BoundingBoxState {
    pub bboxes: HashMap<String, BoundingBox>,
    pub clients: HashSet<String>,
}

impl BoundingBoxState {
    pub fn new() -> Self {
        Self {
            bboxes: HashMap::new(),
            clients: HashSet::new(),
        }
    }

    pub fn set_bbox(&mut self, connection_id: &str, bbox: BoundingBox) {
        self.bboxes.insert(connection_id.to_string(), bbox.clone());
        info!(
            "Updated {} bounding box: NE({}, {}), SW({}, {})",
            connection_id,
            bbox.north_east_lat,
            bbox.north_east_lng,
            bbox.south_west_lat,
            bbox.south_west_lng
        );
    }

    pub fn has_bbox(&self, connection_id: &str) -> bool {
        self.bboxes.contains_key(connection_id)
    }

    pub fn get_bbox(&self, connection_id: &str) -> Option<&BoundingBox> {
        self.bboxes.get(connection_id)
    }

    pub fn remove_bbox(&mut self, connection_id: &str) {
        self.bboxes.remove(connection_id);
    }
}

// Check if an aircraft is within a specific client's bounding box
pub fn is_within_bbox(
    aircraft: &StateVector,
    state: &BoundingBoxState,
    connection_id: &str,
) -> bool {
    // If no bounding box is set for this connection, include all aircraft
    if !state.has_bbox(connection_id) {
        return true;
    }

    let bbox = match state.get_bbox(connection_id) {
        Some(bbox) => bbox,
        None => return true,
    };

    let lat = match aircraft.latitude {
        Some(lat) => lat,
        None => return false,
    };

    let lng = match aircraft.longitude {
        Some(lng) => lng,
        None => return false,
    };

    bbox.south_west_lat <= lat
        && lat <= bbox.north_east_lat
        && bbox.south_west_lng <= lng
        && lng <= bbox.north_east_lng
}

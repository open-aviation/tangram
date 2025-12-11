use crate::stream::Positioned;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub north_east_lat: f64,
    pub north_east_lng: f64,
    pub south_west_lat: f64,
    pub south_west_lng: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedEntity {
    pub id: String,
    #[serde(rename = "typeName")]
    pub type_name: String,
}

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
    #[serde(rename = "selectedEntity")]
    pub selected_entity: Option<SelectedEntity>,
}

#[derive(Default)]
pub struct BoundingBoxState {
    pub bboxes: HashMap<String, BoundingBox>,
    pub selections: HashMap<String, SelectedEntity>,
    pub clients: HashSet<String>,
}

impl BoundingBoxState {
    pub fn new() -> Self {
        Self {
            bboxes: HashMap::new(),
            selections: HashMap::new(),
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

    pub fn set_selected(&mut self, connection_id: &str, entity: Option<SelectedEntity>) {
        match entity {
            Some(e) => {
                self.selections.insert(connection_id.to_string(), e);
            }
            _ => {
                self.selections.remove(connection_id);
            }
        }
    }

    pub fn has_bbox(&self, connection_id: &str) -> bool {
        self.bboxes.contains_key(connection_id)
    }

    pub fn get_bbox(&self, connection_id: &str) -> Option<&BoundingBox> {
        self.bboxes.get(connection_id)
    }

    pub fn get_selected(&self, connection_id: &str) -> Option<&SelectedEntity> {
        self.selections.get(connection_id)
    }

    pub fn remove_client(&mut self, connection_id: &str) {
        self.bboxes.remove(connection_id);
        self.selections.remove(connection_id);
        self.clients.remove(connection_id);
    }
}

pub fn is_within_bbox<T: Positioned>(
    item: &T,
    state: &BoundingBoxState,
    connection_id: &str,
) -> bool {
    if !state.has_bbox(connection_id) {
        return true;
    }

    let bbox = match state.get_bbox(connection_id) {
        Some(bbox) => bbox,
        None => return true,
    };

    let lat = match item.latitude() {
        Some(lat) => lat,
        None => return false,
    };

    let lng = match item.longitude() {
        Some(lng) => lng,
        None => return false,
    };

    bbox.south_west_lat <= lat
        && lat <= bbox.north_east_lat
        && bbox.south_west_lng <= lng
        && lng <= bbox.north_east_lng
}

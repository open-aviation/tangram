use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ControlMessage {
    #[serde(rename = "ping")]
    Ping { sender: String },
    #[serde(rename = "register_table")]
    RegisterTable(RegisterTable),
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ControlResponse {
    #[serde(rename = "table_registered")]
    TableRegistered {
        request_id: String,
        table_name: String,
        table_uri: String,
    },
    #[serde(rename = "registration_failed")]
    RegistrationFailed {
        request_id: String,
        table_name: String,
        error: String,
    },
    #[serde(rename = "pong")]
    Pong { sender: String },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RegisterTable {
    pub sender_id: String,
    pub table_name: String,
    /// base64 encoded arrow ipc schema format
    pub schema: String,
    pub partition_columns: Vec<String>,
    pub optimize_interval_secs: u64,
    pub optimize_target_file_size: u64,
    pub vacuum_interval_secs: u64,
    pub vacuum_retention_period_secs: Option<u64>,
    pub checkpoint_interval: u64,
}

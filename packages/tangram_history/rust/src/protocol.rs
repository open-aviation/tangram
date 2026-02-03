use serde::{Deserialize, Serialize};

#[cfg(feature = "pyo3")]
use pyo3::prelude::*;
#[cfg(feature = "pyo3")]
use pyo3::{exceptions::PyValueError, types::PyBytes};
#[cfg(feature = "stubgen")]
use pyo3_stub_gen::derive::*;

#[cfg_attr(feature = "stubgen", gen_stub_pyclass_complex_enum)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum ControlMessage {
    #[serde(rename = "ping")]
    Ping { sender: String },
    #[serde(rename = "register_table")]
    RegisterTable(RegisterTable),
    #[serde(rename = "list_tables")]
    ListTables { sender_id: String },
    /// Deletes rows in a table using with a specified predicate.
    ///
    /// **WARNING**:
    ///
    /// The current implementation uses raw string formatting to query row counts and previews, with
    /// the following SQL operations disallowed
    ///
    /// - [DDL](https://docs.rs/datafusion/latest/datafusion/logical_expr/enum.DdlStatement.html)
    /// - [DML](https://docs.rs/datafusion/latest/datafusion/logical_expr/struct.DmlStatement.html)
    /// - [Statements](https://docs.rs/datafusion/latest/datafusion/logical_expr/enum.Statement.html)
    ///
    /// It may be prone to SQL injection.
    #[serde(rename = "delete_rows")]
    DeleteRows {
        sender_id: String,
        table_name: String,
        /// The predicate expression, which must have Boolean type
        ///
        /// See: <https://docs.rs/datafusion/latest/datafusion/logical_expr/enum.Expr.html>
        predicate: String,
        dry_run: bool,
    },
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl ControlMessage {
    #[staticmethod]
    fn from_json_bytes(data: &Bound<'_, PyBytes>) -> PyResult<Self> {
        serde_json::from_slice(data.as_bytes())
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON for ControlMessage: {}", e)))
    }

    fn to_json_bytes<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
        let vec = serde_json::to_vec(self).map_err(|e| {
            PyValueError::new_err(format!("Failed to serialize ControlMessage: {}", e))
        })?;
        Ok(PyBytes::new(py, &vec))
    }
}

#[cfg_attr(feature = "stubgen", gen_stub_pyclass_complex_enum)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Serialize, Deserialize, Debug, Clone)]
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
    #[serde(rename = "table_list")]
    TableList {
        request_id: String,
        tables: Vec<TableInfo>,
    },
    #[serde(rename = "delete_output")]
    /// Successful delete response with affected row count and optional preview.
    DeleteOutput {
        request_id: String,
        dry_run: bool,
        affected_rows: usize,
        /// JSON string of RecordBatch
        preview: Option<String>,
    },
    #[serde(rename = "command_failed")]
    /// Returned when a control command fails; contains the error message.
    CommandFailed { request_id: String, error: String },
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl ControlResponse {
    #[staticmethod]
    fn from_json_bytes(data: &Bound<'_, PyBytes>) -> PyResult<Self> {
        serde_json::from_slice(data.as_bytes())
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON for ControlResponse: {}", e)))
    }

    fn to_json_bytes<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
        let vec = serde_json::to_vec(self).map_err(|e| {
            PyValueError::new_err(format!("Failed to serialize ControlResponse: {}", e))
        })?;
        Ok(PyBytes::new(py, &vec))
    }
}

#[cfg_attr(feature = "stubgen", gen_stub_pyclass)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableInfo {
    pub name: String,
    pub uri: String,
    pub version: i64,
    /// Serialised JSON schema
    pub schema: String, // TODO: maybe expose it in PyO3?
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl TableInfo {
    #[staticmethod]
    fn from_json_bytes(data: &Bound<'_, PyBytes>) -> PyResult<Self> {
        serde_json::from_slice(data.as_bytes())
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON for TableInfo: {}", e)))
    }

    fn to_json_bytes<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
        let vec = serde_json::to_vec(self)
            .map_err(|e| PyValueError::new_err(format!("Failed to serialize TableInfo: {}", e)))?;
        Ok(PyBytes::new(py, &vec))
    }
}

#[cfg_attr(feature = "stubgen", gen_stub_pyclass)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegisterTable {
    pub sender_id: String,
    pub table_name: String,
    /// Base64 encoded arrow ipc schema format
    pub schema: String,
    pub partition_columns: Vec<String>,
    pub optimize_interval_secs: u64,
    pub optimize_target_file_size: u64,
    pub vacuum_interval_secs: u64,
    pub vacuum_retention_period_secs: Option<u64>,
    pub checkpoint_interval: u64,
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl RegisterTable {
    #[staticmethod]
    fn from_json_bytes(data: &Bound<'_, PyBytes>) -> PyResult<Self> {
        serde_json::from_slice(data.as_bytes())
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON for RegisterTable: {}", e)))
    }

    fn to_json_bytes<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
        let vec = serde_json::to_vec(self).map_err(|e| {
            PyValueError::new_err(format!("Failed to serialize RegisterTable: {}", e))
        })?;
        Ok(PyBytes::new(py, &vec))
    }
}

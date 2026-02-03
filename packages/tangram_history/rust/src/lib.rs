#[cfg(feature = "client")]
pub mod client;
pub mod protocol;
#[cfg(feature = "server")]
mod service;

#[cfg(feature = "server")]
use service::{perform_actual_delete, perform_dry_run_delete, start_ingest_service, IngestConfig};

#[cfg(all(feature = "pyo3", feature = "server"))]
use pyo3::exceptions::PyRuntimeError;
#[cfg(feature = "pyo3")]
use pyo3::{exceptions::PyOSError, prelude::*};

#[cfg(feature = "stubgen")]
use pyo3_stub_gen::derive::*;

#[cfg(feature = "pyo3")]
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[cfg(feature = "server")]
use std::path::PathBuf;

#[cfg(feature = "pyo3")]
#[cfg(feature = "server")]
use crate::protocol::{ControlResponse, TableInfo};

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyfunction)]
#[pyfunction]
fn init_tracing_stderr(filter_str: String) -> PyResult<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::new(filter_str))
        .with(fmt::layer().with_writer(std::io::stderr))
        .try_init()
        .map_err(|e| PyOSError::new_err(e.to_string()))
}

#[cfg(feature = "server")]
#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyfunction)]
#[pyfunction]
/// List history tables by inspecting the on-disk Delta Lake directory.
///
/// :raises OSError: if the table does not exist or filesystem access fails.
fn list_tables_offline(base_path: String) -> PyResult<Vec<TableInfo>> {
    use deltalake::DeltaTableBuilder;
    use protocol::TableInfo;
    use tokio::runtime::Runtime;

    let rt = Runtime::new().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
    rt.block_on(async {
        let mut tables = Vec::new();
        let path = PathBuf::from(&base_path);

        if !path.exists() {
            return Ok(Vec::new());
        }

        let mut entries = tokio::fs::read_dir(path)
            .await
            .map_err(|e| PyOSError::new_err(e.to_string()))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| PyOSError::new_err(e.to_string()))?
        {
            if !entry
                .file_type()
                .await
                .map_err(|e| PyOSError::new_err(e.to_string()))?
                .is_dir()
            {
                continue;
            }
            let table_name = entry.file_name().to_string_lossy().to_string();
            let table_path = entry.path();
            let table_url = url::Url::from_directory_path(table_path)
                .map_err(|_| PyOSError::new_err("Invalid table path"))?;

            if let Ok(builder) = DeltaTableBuilder::from_url(table_url.clone()) {
                if let Ok(table) = builder.load().await {
                    if let Ok(snapshot) = table.snapshot() {
                        let schema_json = serde_json::to_value(snapshot.schema())
                            .unwrap_or(serde_json::Value::String("schema_error".to_string()));
                        tables.push(TableInfo {
                            name: table_name,
                            uri: table_url.to_string(),
                            version: table.version().unwrap_or(-1),
                            schema: schema_json.to_string(),
                        });
                    }
                }
            }
        }
        Ok(tables)
    })
}

#[cfg(feature = "server")]
#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyfunction)]
#[pyfunction]
/// Delete rows from a history table stored on disk.
///
/// :raises OSError: if the table does not exist or filesystem access fails.
/// :return: ControlResponse.DeleteOutput on success, ControlResponse.CommandFailed on failure.
fn delete_rows_offline(
    base_path: String,
    table_name: String,
    predicate: String,
    dry_run: bool,
) -> PyResult<ControlResponse> {
    use deltalake::DeltaTableBuilder;
    use tokio::runtime::Runtime;
    use uuid::Uuid;

    let rt = Runtime::new().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
    rt.block_on(async {
        let table_path = PathBuf::from(&base_path).join(&table_name);
        if !table_path.exists() {
            return Err(PyOSError::new_err(format!(
                "table {} not found at {:?}",
                table_name, table_path
            )));
        }

        let table_url = url::Url::from_directory_path(table_path)
            .map_err(|_| PyOSError::new_err("Invalid table path"))?;

        let table = DeltaTableBuilder::from_url(table_url)
            .map_err(|e| PyOSError::new_err(e.to_string()))?
            .load()
            .await
            .map_err(|e| PyOSError::new_err(e.to_string()))?;

        let sender_id = Uuid::new_v4().to_string();
        let response = if dry_run {
            perform_dry_run_delete(sender_id, table, predicate).await
        } else {
            perform_actual_delete(sender_id, table, predicate).await
        };

        Ok(response)
    })
}

#[cfg(feature = "server")]
#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyclass)]
#[pyclass(get_all, set_all)]
#[derive(Debug, Clone)]
pub struct HistoryConfig {
    pub redis_url: String,
    pub control_channel: String,
    pub base_path: String,
    pub redis_read_count: usize,
    pub redis_read_block_ms: usize,
}

#[cfg(feature = "server")]
#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl HistoryConfig {
    #[new]
    fn new(
        redis_url: String,
        control_channel: String,
        base_path: String,
        redis_read_count: usize,
        redis_read_block_ms: usize,
    ) -> Self {
        Self {
            redis_url,
            control_channel,
            base_path,
            redis_read_count,
            redis_read_block_ms,
        }
    }
}

// NOTE: right now we do a super convoluted way to get plugins to control
// history. for each plugin, they:
// 1. define *flattened* `history_*` in dataclasses AND rust structs
// 2. which are then parsed by Pydantic TypeAdapter on the python side
// 3. before manually constructing this struct in rust.
//
// one solution would be to directly expose this struct with `pyo3(signature)`,
// but:
// - it is unclear how to make pyo3-exposed objects compatible with pydantic
//   TypeAdapter: https://github.com/pydantic/pydantic/discussions/8854
// - for some reason pyo3-stubgen has linking issues when generating the .pyi:
//   https://github.com/Jij-Inc/pyo3-stub-gen/issues/161 (not exact the same
//   but similar)
//
// so for sadly we have to accept manually duplicating `history_*` in all plugin
// configs.
#[derive(Debug, Clone)]
pub struct HistoryProducerConfig {
    pub table_name: String,
    pub buffer_size: usize,
    pub flush_interval_secs: u64,
    pub optimize_interval_secs: u64,
    pub optimize_target_file_size: u64,
    pub vacuum_interval_secs: u64,
    pub vacuum_retention_period_secs: Option<u64>,
    pub checkpoint_interval: u64,
}

#[cfg(feature = "server")]
async fn _run_service(config: IngestConfig) -> anyhow::Result<()> {
    start_ingest_service(config).await
}

#[cfg(feature = "server")]
#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyfunction)]
#[pyfunction]
/// Start the history ingest service.
///
/// :raises RuntimeError: if the service fails to start or crashes.
fn run_history(py: Python<'_>, config: HistoryConfig) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        let ingest_config = IngestConfig {
            redis_url: config.redis_url.clone(),
            control_channel: config.control_channel.clone(),
            base_path: config.base_path.clone(),
            redis_read_count: config.redis_read_count,
            redis_read_block_ms: config.redis_read_block_ms,
        };
        _run_service(ingest_config)
            .await
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    })
}

#[cfg(feature = "pyo3")]
#[pymodule]
fn _history(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(init_tracing_stderr, m)?)?;
    m.add_class::<protocol::ControlMessage>()?;
    m.add_class::<protocol::ControlResponse>()?;
    m.add_class::<protocol::TableInfo>()?;
    m.add_class::<protocol::RegisterTable>()?;

    #[cfg(feature = "server")]
    {
        m.add_function(wrap_pyfunction!(run_history, m)?)?;
        m.add_function(wrap_pyfunction!(list_tables_offline, m)?)?;
        m.add_function(wrap_pyfunction!(delete_rows_offline, m)?)?;
        m.add_class::<HistoryConfig>()?;
    }
    Ok(())
}

#[cfg(feature = "stubgen")]
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let manifest_dir: &::std::path::Path = env!("CARGO_MANIFEST_DIR").as_ref();
    let pyproject_path = manifest_dir.parent().unwrap().join("pyproject.toml");
    pyo3_stub_gen::StubInfo::from_pyproject_toml(pyproject_path)
}

#[cfg(feature = "client")]
pub mod client;
pub mod protocol;
#[cfg(feature = "server")]
mod service;

#[cfg(feature = "server")]
use service::{start_ingest_service, IngestConfig};

#[cfg(all(feature = "pyo3", feature = "server"))]
use pyo3::exceptions::PyRuntimeError;
#[cfg(feature = "pyo3")]
use pyo3::{exceptions::PyOSError, prelude::*};

#[cfg(feature = "stubgen")]
use pyo3_stub_gen::derive::*;

#[cfg(feature = "pyo3")]
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

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
    #[cfg(feature = "server")]
    {
        m.add_function(wrap_pyfunction!(run_history, m)?)?;
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

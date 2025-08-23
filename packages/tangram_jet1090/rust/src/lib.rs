pub mod aircraftdb;
pub mod bbox;
pub mod state;
pub mod stream;

use anyhow::{Context, Result};
#[cfg(feature = "python")]
use pyo3::{
    exceptions::{PyOSError, PyRuntimeError},
    prelude::*,
};
#[cfg(feature = "python")]
use pyo3_stub_gen::derive::*;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::bbox::BoundingBoxState;
use crate::state::StateVectors;
use crate::stream::{start_jet1090_subscriber, start_redis_subscriber, stream_statevectors};

// TODO: use https://crates.io/crates/pyo3-tracing-subscriber
#[cfg(feature = "python")]
#[gen_stub_pyfunction]
#[pyfunction]
fn init_logging(level: &str) -> PyResult<()> {
    let filter = tracing_subscriber::EnvFilter::try_new(level)
        .map_err(|e| PyOSError::new_err(e.to_string()))?;
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
    Ok(())
}

#[cfg_attr(feature = "python", gen_stub_pyclass)]
#[cfg_attr(feature = "python", pyclass(get_all, set_all))]
#[derive(Debug, Clone)]
pub struct PlanesConfig {
    pub redis_url: String,
    pub jet1090_channel: String,
    pub history_expire: u16,
}

#[cfg(feature = "python")]
#[gen_stub_pymethods]
#[pymethods]
impl PlanesConfig {
    #[new]
    fn new(redis_url: String, jet1090_channel: String, history_expire: u16) -> Self {
        Self {
            redis_url,
            jet1090_channel,
            history_expire,
        }
    }
}

async fn _run_service(config: PlanesConfig) -> Result<()> {
    let bbox_state = Arc::new(Mutex::new(BoundingBoxState::new()));
    let bbox_subscriber_state = Arc::clone(&bbox_state);

    let redis_url_clone1 = config.redis_url.clone();
    let bbox_subscriber_handle = tokio::spawn(async move {
        match start_redis_subscriber(redis_url_clone1, bbox_subscriber_state).await {
            Ok(_) => info!("BoundingBox subscriber stopped normally"),
            Err(e) => error!("BoundingBox subscriber error: {}", e),
        }
    });

    let client = redis::Client::open(config.redis_url.clone())
        .context("Failed to create Redis client for state vectors")?;
    let state_vectors = Arc::new(Mutex::new(
        StateVectors::new(config.history_expire, client).await,
    ));
    let jet1090_subscriber_state = Arc::clone(&state_vectors);

    let redis_url_clone2 = config.redis_url.clone();
    let jet1090_subscriber_handle = tokio::spawn(async move {
        match start_jet1090_subscriber(
            redis_url_clone2,
            config.jet1090_channel,
            jet1090_subscriber_state,
        )
        .await
        {
            Ok(_) => info!("Jet1090 subscriber stopped normally"),
            Err(e) => error!("Jet1090 subscriber error: {}", e),
        }
    });

    let streaming_handle = tokio::spawn(async move {
        match stream_statevectors(config.redis_url, bbox_state, state_vectors).await {
            Ok(_) => info!("Streaming task stopped normally"),
            Err(e) => error!("Streaming task error: {}", e),
        }
    });

    tokio::select! {
        _ = bbox_subscriber_handle => {
            error!("BoundingBox subscriber task exited unexpectedly");
        }
        _ = jet1090_subscriber_handle => {
            error!("Jet1090 subscriber task exited unexpectedly");
        }
        _ = streaming_handle => {
            error!("Streaming task exited unexpectedly");
        }
    }

    Ok(())
}

#[cfg(feature = "python")]
#[gen_stub_pyfunction]
#[pyfunction]
fn run_planes(py: Python, config: PlanesConfig) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        _run_service(config)
            .await
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    })
}

#[cfg(feature = "python")]
#[pymodule]
fn _planes(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(run_planes, m)?)?;
    m.add_function(wrap_pyfunction!(init_logging, m)?)?;
    m.add_class::<PlanesConfig>()?;
    Ok(())
}

#[cfg(feature = "python")]
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let manifest_dir: &::std::path::Path = env!("CARGO_MANIFEST_DIR").as_ref();
    let pyproject_path = manifest_dir.parent().unwrap().join("pyproject.toml");
    pyo3_stub_gen::StubInfo::from_pyproject_toml(pyproject_path)
}

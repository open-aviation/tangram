pub mod state;

use anyhow::{Context, Result};
#[cfg(feature = "pyo3")]
use pyo3::{
    exceptions::{PyOSError, PyRuntimeError},
    prelude::*,
};
#[cfg(feature = "pyo3")]
use pyo3_stub_gen::derive::*;
use std::{collections::BTreeMap, sync::Arc};
use tangram_core::{
    bbox::BoundingBoxState,
    stream::{start_redis_subscriber, stream_statevectors, StreamConfig},
};
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::state::{Aircraft, Jet1090Message, StateVectors};
#[cfg(feature = "pyo3")]
use pyo3_python_tracing_subscriber::PythonCallbackLayerBridge;
#[cfg(feature = "pyo3")]
use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use futures::StreamExt;

#[cfg(feature = "pyo3")]
#[gen_stub_pyfunction]
#[pyfunction]
fn init_tracing_python(py_layer: Bound<'_, PyAny>, filter_str: String) -> PyResult<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::new(filter_str))
        .with(PythonCallbackLayerBridge::new(py_layer))
        .try_init()
        .map_err(|e| PyOSError::new_err(e.to_string()))
}

#[cfg(feature = "pyo3")]
#[gen_stub_pyfunction]
#[pyfunction]
fn init_tracing_stderr(filter_str: String) -> PyResult<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::new(filter_str))
        .with(fmt::layer().with_writer(std::io::stderr))
        .try_init()
        .map_err(|e| PyOSError::new_err(e.to_string()))
}

#[cfg_attr(feature = "pyo3", gen_stub_pyclass)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Debug, Clone)]
pub struct PlanesConfig {
    pub redis_url: String,
    pub jet1090_channel: String,
    pub history_expire: u16,
    pub stream_interval_secs: f64,
    pub aircraft_db: BTreeMap<String, Aircraft>,
}

#[cfg(feature = "pyo3")]
#[gen_stub_pymethods]
#[pymethods]
impl PlanesConfig {
    #[new]
    fn new(
        redis_url: String,
        jet1090_channel: String,
        history_expire: u16,
        stream_interval_secs: f64,
        aircraft_db: BTreeMap<String, Aircraft>,
    ) -> Self {
        Self {
            redis_url,
            jet1090_channel,
            history_expire,
            stream_interval_secs,
            aircraft_db,
        }
    }
}

async fn start_jet1090_subscriber(
    redis_url: String,
    channel: String,
    state_vectors: Arc<Mutex<StateVectors>>,
) -> Result<()> {
    let client = redis::Client::open(redis_url.clone())
        .context("Failed to create Redis client for Jet1090 subscriber")?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;

    info!(
        "Jet1090 subscriber started, listening for aircraft updates on channel '{}'...",
        channel
    );

    let mut stream = pubsub.on_message();

    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload()?;
        if !payload.contains(r#""17""#)
            && !payload.contains(r#""18""#)
            && !payload.contains(r#""20""#)
            && !payload.contains(r#""21""#)
        {
            continue;
        }

        match serde_json::from_str::<Jet1090Message>(&payload) {
            Ok(jet1090_msg) => {
                let mut state = state_vectors.lock().await;
                if let Err(e) = state.add(&jet1090_msg).await {
                    error!("Failed to add aircraft data: {}", e);
                }
            }
            Err(e) => {
                error!(
                    "Failed to parse Jet1090 message: {} - Error: {}",
                    payload, e
                );
            }
        }
    }
    Ok(())
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
        StateVectors::new(config.history_expire, client, config.aircraft_db).await?,
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

    let stream_config = StreamConfig {
        redis_url: config.redis_url,
        stream_interval_secs: config.stream_interval_secs,
        entity_type_name: "aircraft".to_string(),
        broadcast_channel_suffix: "new-jet1090-data".to_string(),
    };

    let streaming_handle =
        tokio::spawn(
            async move { stream_statevectors(stream_config, bbox_state, state_vectors).await },
        );

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("shutting down");
        },
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

#[cfg(feature = "pyo3")]
#[gen_stub_pyfunction]
#[pyfunction]
fn run_planes(py: Python<'_>, config: PlanesConfig) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        _run_service(config)
            .await
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    })
}

#[cfg(feature = "pyo3")]
#[pymodule]
fn _planes(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(run_planes, m)?)?;
    m.add_function(wrap_pyfunction!(init_tracing_python, m)?)?;
    m.add_function(wrap_pyfunction!(init_tracing_stderr, m)?)?;
    m.add_class::<PlanesConfig>()?;
    m.add_class::<state::Aircraft>()?;
    Ok(())
}

#[cfg(feature = "pyo3")]
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let manifest_dir: &::std::path::Path = env!("CARGO_MANIFEST_DIR").as_ref();
    let pyproject_path = manifest_dir.parent().unwrap().join("pyproject.toml");
    pyo3_stub_gen::StubInfo::from_pyproject_toml(pyproject_path)
}
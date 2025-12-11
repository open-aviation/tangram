pub mod state;

use anyhow::{Context, Result};
#[cfg(feature = "pyo3")]
use pyo3::{
    exceptions::{PyOSError, PyRuntimeError},
    prelude::*,
};
#[cfg(feature = "stubgen")]
use pyo3_stub_gen::derive::*;

use std::sync::Arc;
use tangram_core::{
    bbox::BoundingBoxState,
    stream::{start_redis_subscriber, stream_statevectors, StreamConfig},
};
use tangram_history::{client::start_producer_service_components, HistoryProducerConfig};
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::state::{ShipHistoryFrame, ShipStateVectors, TimedMessage};
use futures::StreamExt;
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

#[cfg_attr(feature = "stubgen", gen_stub_pyclass)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Debug, Clone)]
pub struct ShipsConfig {
    pub redis_url: String,
    pub ship162_channel: String,
    pub history_control_channel: String,
    pub state_vector_expire: u16,
    pub stream_interval_secs: f64,
    pub history_table_name: String,
    pub history_buffer_size: usize,
    pub history_flush_interval_secs: u64,
    pub history_optimize_interval_secs: u64,
    pub history_optimize_target_file_size: u64,
    pub history_vacuum_interval_secs: u64,
    pub history_vacuum_retention_period_secs: Option<u64>,
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl ShipsConfig {
    #[new]
    #[allow(clippy::too_many_arguments)]
    fn new(
        redis_url: String,
        ship162_channel: String,
        history_control_channel: String,
        state_vector_expire: u16,
        stream_interval_secs: f64,
        history_table_name: String,
        history_buffer_size: usize,
        history_flush_interval_secs: u64,
        history_optimize_interval_secs: u64,
        history_optimize_target_file_size: u64,
        history_vacuum_interval_secs: u64,
        history_vacuum_retention_period_secs: Option<u64>,
    ) -> Self {
        Self {
            redis_url,
            ship162_channel,
            history_control_channel,
            state_vector_expire,
            stream_interval_secs,
            history_table_name,
            history_buffer_size,
            history_flush_interval_secs,
            history_optimize_interval_secs,
            history_optimize_target_file_size,
            history_vacuum_interval_secs,
            history_vacuum_retention_period_secs,
        }
    }
}

async fn start_ship162_subscriber(
    redis_url: String,
    channel: String,
    state_vectors: Arc<Mutex<ShipStateVectors>>,
) -> Result<()> {
    let client = redis::Client::open(redis_url.clone()).context("Failed to create Redis client")?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;

    info!(
        "ship162 subscriber started, listening for ship updates on channel '{}'...",
        channel
    );

    let mut stream = pubsub.on_message();

    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload()?;
        match serde_json::from_str::<TimedMessage>(&payload) {
            Ok(ship162_msg) => {
                let mut state = state_vectors.lock().await;
                state.add(&ship162_msg).await;
            }
            Err(e) => {
                error!(
                    "Failed to parse ship162 message: {} - Error: {}",
                    payload, e
                );
            }
        }
    }
    Ok(())
}
async fn _run_service(config: ShipsConfig) -> Result<()> {
    let bbox_state = Arc::new(Mutex::new(BoundingBoxState::new()));
    let bbox_subscriber_state = Arc::clone(&bbox_state);

    let redis_url_clone1 = config.redis_url.clone();
    let bbox_subscriber_handle = tokio::spawn(async move {
        match start_redis_subscriber(redis_url_clone1, bbox_subscriber_state).await {
            Ok(_) => info!("BoundingBox subscriber stopped normally"),
            Err(e) => error!("BoundingBox subscriber error: {}", e),
        }
    });

    let state_vectors = Arc::new(Mutex::new(ShipStateVectors::new(
        config.state_vector_expire,
        None,
    )));

    let history_setup_state_vectors = Arc::clone(&state_vectors);
    let history_config_clone = config.clone();
    tokio::spawn(async move {
        let history_config = HistoryProducerConfig {
            table_name: history_config_clone.history_table_name.clone(),
            buffer_size: history_config_clone.history_buffer_size,
            flush_interval_secs: history_config_clone.history_flush_interval_secs,
            optimize_interval_secs: history_config_clone.history_optimize_interval_secs,
            optimize_target_file_size: history_config_clone.history_optimize_target_file_size,
            vacuum_interval_secs: history_config_clone.history_vacuum_interval_secs,
            vacuum_retention_period_secs: history_config_clone.history_vacuum_retention_period_secs,
        };

        if let Ok(Some(buffer)) = start_producer_service_components::<ShipHistoryFrame>(
            history_config_clone.redis_url.clone(),
            history_config,
            history_config_clone.history_control_channel.clone(),
        )
        .await
        {
            let mut state = history_setup_state_vectors.lock().await;
            state.set_history_buffer(buffer);
            info!("history service for ship162 connected and buffer is set.");
        }
    });

    let ship162_subscriber_state = Arc::clone(&state_vectors);

    let redis_url_clone2 = config.redis_url.clone();
    let ship162_subscriber_handle = tokio::spawn(async move {
        match start_ship162_subscriber(
            redis_url_clone2,
            config.ship162_channel,
            ship162_subscriber_state,
        )
        .await
        {
            Ok(_) => info!("ship162 subscriber stopped normally"),
            Err(e) => error!("ship162 subscriber error: {}", e),
        }
    });

    let stream_config = StreamConfig {
        redis_url: config.redis_url,
        stream_interval_secs: config.stream_interval_secs,
        entity_type_name: "ship".to_string(),
        entity_type: "ship162_ship".to_string(),
        broadcast_channel_suffix: "new-ship162-data".to_string(),
    };

    let streaming_handle =
        tokio::spawn(
            async move { stream_statevectors(stream_config, bbox_state, state_vectors).await },
        );

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("shutting down");
        },
        res = bbox_subscriber_handle => {
            error!("BoundingBox subscriber task exited unexpectedly: {:?}", res);
        }
        res = ship162_subscriber_handle => {
            error!("ship162 subscriber task exited unexpectedly: {:?}", res);
        }
        res = streaming_handle => {
            error!("Streaming task exited unexpectedly: {:?}", res);
        }
    }

    Ok(())
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyfunction)]
#[pyfunction]
fn run_ships(py: Python<'_>, config: ShipsConfig) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        _run_service(config)
            .await
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    })
}

#[cfg(feature = "pyo3")]
#[pymodule]
fn _ships(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(run_ships, m)?)?;
    m.add_function(wrap_pyfunction!(init_tracing_stderr, m)?)?;
    m.add_class::<ShipsConfig>()?;
    Ok(())
}

#[cfg(feature = "stubgen")]
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let manifest_dir: &::std::path::Path = env!("CARGO_MANIFEST_DIR").as_ref();
    let pyproject_path = manifest_dir.parent().unwrap().join("pyproject.toml");
    pyo3_stub_gen::StubInfo::from_pyproject_toml(pyproject_path)
}

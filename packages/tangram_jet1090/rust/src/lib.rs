pub mod state;

use anyhow::{Context, Result};
use futures::StreamExt;
#[cfg(feature = "pyo3")]
use pyo3::{
    exceptions::{PyOSError, PyRuntimeError},
    prelude::*,
};
#[cfg(feature = "stubgen")]
use pyo3_stub_gen::derive::*;
use redis::AsyncCommands;
use rs1090::prelude::TimedMessage;
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tangram_core::{
    bbox::BoundingBoxState,
    shutdown::{abort_and_await, Shutdown},
    stream::{start_redis_subscriber, stream_statevectors, StreamConfig},
};
use tangram_history::{client::start_producer_service_components, HistoryProducerConfig};
use tokio::sync::{watch, Mutex};
use tokio::time;
use tracing::{debug, error, info};
#[cfg(feature = "pyo3")]
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::state::{Aircraft, Jet1090HistoryFrame, StateVectors};

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
pub struct PlanesConfig {
    pub redis_url: String,
    pub jet1090_channel: String,
    pub history_table_name: String,
    pub history_control_channel: String,
    pub state_vector_expire: u16,
    pub stream_interval_secs: f64,
    pub aircraft_db: BTreeMap<String, Aircraft>,
    pub history_buffer_size: usize,
    pub history_flush_interval_secs: u64,
    pub history_optimize_interval_secs: u64,
    pub history_optimize_target_file_size: u64,
    pub history_vacuum_interval_secs: u64,
    pub history_vacuum_retention_period_secs: Option<u64>,
    pub history_checkpoint_interval: u64,
    pub search_channel: String,
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl PlanesConfig {
    #[new]
    #[allow(clippy::too_many_arguments)]
    fn new(
        redis_url: String,
        jet1090_channel: String,
        history_table_name: String,
        history_control_channel: String,
        state_vector_expire: u16,
        stream_interval_secs: f64,
        aircraft_db: BTreeMap<String, Aircraft>,
        history_buffer_size: usize,
        history_flush_interval_secs: u64,
        history_optimize_interval_secs: u64,
        history_optimize_target_file_size: u64,
        history_vacuum_interval_secs: u64,
        history_vacuum_retention_period_secs: Option<u64>,
        history_checkpoint_interval: u64,
        search_channel: String,
    ) -> Self {
        Self {
            redis_url,
            jet1090_channel,
            history_table_name,
            history_control_channel,
            state_vector_expire,
            stream_interval_secs,
            aircraft_db,
            history_buffer_size,
            history_flush_interval_secs,
            history_optimize_interval_secs,
            history_optimize_target_file_size,
            history_vacuum_interval_secs,
            history_vacuum_retention_period_secs,
            history_checkpoint_interval,
            search_channel,
        }
    }
}

async fn start_jet1090_subscriber(
    redis_url: String,
    channel: String,
    state_vectors: Arc<Mutex<StateVectors>>,
    mut shutdown: watch::Receiver<bool>,
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

    loop {
        if *shutdown.borrow() {
            break;
        }

        let msg = tokio::select! {
            msg = stream.next() => msg,
            res = shutdown.changed() => {
                let _ = res;
                break;
            }
        };

        let Some(msg) = msg else {
            break;
        };

        let payload: String = msg.get_payload()?;
        match serde_json::from_str::<TimedMessage>(&payload) {
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

async fn start_search_subscriber(
    redis_url: String,
    search_channel: String,
    state_vectors: Arc<Mutex<StateVectors>>,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    let client = redis::Client::open(redis_url)?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let mut pubsub = client.get_async_pubsub().await?;

    let (channel, event) = search_channel
        .split_once(':')
        .unwrap_or((&search_channel, "search"));

    let topic = format!("from:{}:{}", channel, event);
    pubsub.subscribe(&topic).await?;

    info!("Jet1090 search subscriber listening on '{}'", topic);

    let mut stream = pubsub.on_message();
    loop {
        if *shutdown.borrow() {
            break;
        }

        let msg = tokio::select! {
            msg = stream.next() => msg,
            res = shutdown.changed() => {
                let _ = res;
                break;
            }
        };

        let Some(msg) = msg else {
            break;
        };

        let payload: String = msg.get_payload()?;
        if let Ok(req) = serde_json::from_str::<serde_json::Value>(&payload) {
            if let (Some(query), Some(request_id)) = (
                req.get("query").and_then(|v| v.as_str()),
                req.get("request_id").and_then(|v| v.as_str()),
            ) {
                let results = {
                    let state = state_vectors.lock().await;
                    state.search(query)
                };

                let response_topic = format!("to:{}:{}_result", channel, event);
                let response = serde_json::json!({
                    "request_id": request_id,
                    "data": results
                });

                if let Ok(json) = serde_json::to_string(&response) {
                    let _: Result<(), _> = conn.publish(response_topic, json).await;
                }
            }
        }
    }
    Ok(())
}

async fn _run_service(config: PlanesConfig) -> Result<()> {
    let (shutdown, shutdown_rx) = Shutdown::new();

    let bbox_state = Arc::new(Mutex::new(BoundingBoxState::new()));
    let bbox_subscriber_state = Arc::clone(&bbox_state);

    let redis_url_clone1 = config.redis_url.clone();
    let bbox_shutdown = shutdown_rx;
    let mut bbox_subscriber_handle = tokio::spawn(async move {
        match start_redis_subscriber(redis_url_clone1, bbox_subscriber_state, bbox_shutdown).await {
            Ok(_) => info!("BoundingBox subscriber stopped normally"),
            Err(e) => error!("BoundingBox subscriber error: {}", e),
        }
    });

    let state_vectors = Arc::new(Mutex::new(StateVectors::new(
        config.state_vector_expire,
        config.aircraft_db.clone(),
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
            checkpoint_interval: history_config_clone.history_checkpoint_interval,
        };

        if let Ok(Some(buffer)) = start_producer_service_components::<Jet1090HistoryFrame>(
            history_config_clone.redis_url.clone(),
            history_config,
            history_config_clone.history_control_channel.clone(),
        )
        .await
        {
            let mut state = history_setup_state_vectors.lock().await;
            state.set_history_buffer(buffer);
            info!("history service for jet1090 connected and buffer is set.");
        }
    });

    let jet1090_subscriber_state = Arc::clone(&state_vectors);
    let search_subscriber_state = Arc::clone(&state_vectors);
    let state_vectors_cleanup = Arc::clone(&state_vectors);

    let redis_url_clone2 = config.redis_url.clone();
    let jet1090_shutdown = shutdown.subscribe();
    let mut jet1090_subscriber_handle = tokio::spawn(async move {
        match start_jet1090_subscriber(
            redis_url_clone2,
            config.jet1090_channel,
            jet1090_subscriber_state,
            jet1090_shutdown,
        )
        .await
        {
            Ok(_) => info!("Jet1090 subscriber stopped normally"),
            Err(e) => error!("Jet1090 subscriber error: {}", e),
        }
    });

    let redis_url_clone3 = config.redis_url.clone();
    let search_shutdown = shutdown.subscribe();
    let mut search_subscriber_handle = tokio::spawn(async move {
        match start_search_subscriber(
            redis_url_clone3,
            config.search_channel,
            search_subscriber_state,
            search_shutdown,
        )
        .await
        {
            Ok(_) => info!("Search subscriber stopped normally"),
            Err(e) => error!("Search subscriber error: {}", e),
        }
    });

    let mut cleanup_shutdown = shutdown.subscribe();
    let mut cleanup_handle = tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(config.state_vector_expire as u64));
        loop {
            tokio::select! {
                _ = interval.tick() => {}
                res = cleanup_shutdown.changed() => {
                    let _ = res;
                    break;
                }
            }
            if *cleanup_shutdown.borrow() {
                break;
            }
            let mut state = state_vectors_cleanup.lock().await;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_micros() as u64;
            let expire_micros = config.state_vector_expire as u64 * 1_000_000;
            let initial_len = state.aircraft.len();
            state
                .aircraft
                .retain(|_, sv| sv.lastseen > now.saturating_sub(expire_micros));
            let final_len = state.aircraft.len();
            if initial_len != final_len {
                debug!("cleaned up {} stale aircraft", initial_len - final_len);
            }
        }
    });

    let stream_config = StreamConfig {
        redis_url: config.redis_url,
        stream_interval_secs: config.stream_interval_secs,
        entity_type_name: "aircraft".to_string(),
        entity_type: "jet1090_aircraft".to_string(),
        broadcast_channel_suffix: "new-jet1090-data".to_string(),
    };

    let stream_shutdown = shutdown.subscribe();
    let mut streaming_handle = tokio::spawn(async move {
        stream_statevectors(stream_config, bbox_state, state_vectors, stream_shutdown).await
    });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("shutting down");
        },
        res = &mut bbox_subscriber_handle => {
            error!("BoundingBox subscriber task exited unexpectedly: {:?}", res);
        }
        res = &mut jet1090_subscriber_handle => {
            error!("Jet1090 subscriber task exited unexpectedly: {:?}", res);
        }
        res = &mut search_subscriber_handle => {
            error!("Search subscriber task exited unexpectedly: {:?}", res);
        }
        res = &mut streaming_handle => {
            error!("Streaming task exited unexpectedly: {:?}", res);
        }
        res = &mut cleanup_handle => {
            error!("Cleanup task exited unexpectedly: {:?}", res);
        }
    }

    shutdown.trigger();

    abort_and_await(&mut bbox_subscriber_handle).await;
    abort_and_await(&mut jet1090_subscriber_handle).await;
    abort_and_await(&mut search_subscriber_handle).await;
    abort_and_await(&mut streaming_handle).await;
    abort_and_await(&mut cleanup_handle).await;

    Ok(())
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyfunction)]
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
    m.add_function(wrap_pyfunction!(init_tracing_stderr, m)?)?;
    m.add_class::<PlanesConfig>()?;
    m.add_class::<state::Aircraft>()?;
    Ok(())
}

#[cfg(feature = "stubgen")]
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let manifest_dir: &::std::path::Path = env!("CARGO_MANIFEST_DIR").as_ref();
    let pyproject_path = manifest_dir.parent().unwrap().join("pyproject.toml");
    pyo3_stub_gen::StubInfo::from_pyproject_toml(pyproject_path)
}

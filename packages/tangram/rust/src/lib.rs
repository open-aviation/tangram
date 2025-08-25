use axum::{
    extract::{Query, State as AxumState, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use channel::{
    channel::ChannelControl,
    utils::{generate_jwt, random_string},
    websocket::{axum_on_connected, datetime_handler, State},
};
#[cfg(feature = "python")]
use pyo3::{
    exceptions::{PyConnectionError, PyOSError},
    prelude::*,
};
#[cfg(feature = "python")]
use pyo3_stub_gen::derive::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;
use tower_http::trace::TraceLayer;

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
pub struct ChannelConfig {
    pub host: String,
    pub port: u16,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_expiration_secs: i64,
}

#[cfg(feature = "python")]
#[gen_stub_pymethods]
#[pymethods]
impl ChannelConfig {
    #[new]
    fn new(
        host: String,
        port: u16,
        redis_url: String,
        jwt_secret: String,
        jwt_expiration_secs: i64,
    ) -> Self {
        Self {
            host,
            port,
            redis_url,
            jwt_secret,
            jwt_expiration_secs,
        }
    }
}

#[cfg(feature = "python")]
#[gen_stub_pyfunction]
#[pyfunction]
fn run(py: Python<'_>, config: ChannelConfig) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        run_server(config).await.map_err(|e| e.into())
    })
}

pub async fn run_server(config: ChannelConfig) -> Result<(), ChannelError> {
    let redis_client = redis::Client::open(config.redis_url).map_err(ChannelError::Redis)?;

    let channel_control = ChannelControl::new(Arc::new(redis_client.clone()));
    let state = Arc::new(State {
        ctl: Mutex::new(channel_control),
        redis_client,
        id_length: 8,
        jwt_secret: config.jwt_secret,
        jwt_expiration_secs: config.jwt_expiration_secs,
    });

    let ctl = state.ctl.lock().await;
    ctl.channel_add("phoenix".into(), None).await;
    ctl.channel_add("system".into(), None).await;
    ctl.channel_add("admin".into(), None).await;
    drop(ctl);

    tokio::spawn(datetime_handler(state.clone(), "system".into()));

    let app = Router::new()
        .route("/token", axum::routing::post(generate_token_handler))
        .route("/websocket", get(websocket_handler))
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tracing::info!("channel service listening on {}", addr);
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
struct TokenRequest {
    channel: String,
    id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct TokenResponse {
    channel: String,
    id: String,
    token: String,
}

async fn generate_token_handler(
    AxumState(state): AxumState<Arc<State>>,
    Json(payload): Json<TokenRequest>,
) -> impl IntoResponse {
    let client_id = payload.id.unwrap_or_else(|| random_string(8));
    match generate_jwt(
        client_id.clone(),
        payload.channel.clone(),
        state.jwt_secret.clone(),
        state.jwt_expiration_secs,
    )
    .await
    {
        Ok(token) => Json(TokenResponse {
            channel: payload.channel,
            id: client_id,
            token,
        })
        .into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to generate token: {e}"),
        )
            .into_response(),
    }
}
#[derive(Debug, Clone, Deserialize)]
struct WebSocketParams {
    #[serde(rename = "userToken")]
    user_token: Option<String>,
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<Arc<State>>,
    Query(params): Query<WebSocketParams>,
) -> impl IntoResponse {
    let user_token = params.user_token;
    ws.on_upgrade(move |socket| axum_on_connected(socket, state, user_token))
}

#[derive(Error, Debug)]
pub enum ChannelError {
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("server bind error: {0}")]
    ServerBind(#[from] std::io::Error),
}

#[cfg(feature = "python")]
impl From<ChannelError> for PyErr {
    fn from(err: ChannelError) -> Self {
        match err {
            ChannelError::Redis(e) => PyConnectionError::new_err(e.to_string()),
            ChannelError::ServerBind(e) => PyOSError::new_err(e.to_string()),
        }
    }
}

#[cfg(feature = "python")]
#[pymodule]
fn _channel(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(run, m)?)?;
    m.add_function(wrap_pyfunction!(init_logging, m)?)?;
    m.add_class::<ChannelConfig>()?;
    Ok(())
}

#[cfg(feature = "python")]
// not using define_stub_info_gatherer! macro, we need to
// go up one level from `packages/tangram/rust` to `package/tangram`
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let manifest_dir: &::std::path::Path = env!("CARGO_MANIFEST_DIR").as_ref();
    let pyproject_path = manifest_dir.parent().unwrap().join("pyproject.toml");
    pyo3_stub_gen::StubInfo::from_pyproject_toml(pyproject_path)
}

use axum::{
    extract::{Json, Query, State as AxumState, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use channel::{
    channel::ChannelControl,
    utils::{generate_jwt, random_string},
    websocket::{add_channel, axum_on_connected, datetime_handler, launch_channel_redis_listen_task, State},
};
use clap::Parser;
use futures::StreamExt;
use redis::{Client, RedisResult};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt::format::FmtSpan, EnvFilter};

#[derive(Debug, Serialize, Deserialize)]
struct TokenRequest {
    channel: String,
    id: Option<String>,
}

#[derive(Debug)]
enum TokenError {
    // ChannelNotFound,
    GenerationFailed,
}

impl IntoResponse for TokenError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            // TokenError::ChannelNotFound => (StatusCode::NOT_FOUND, "Channel not found"),
            TokenError::GenerationFailed => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to generate token"),
        };

        (status, message).into_response()
    }
}

async fn generate_token(AxumState(state): AxumState<Arc<State>>, Json(req): Json<TokenRequest>) -> Result<impl IntoResponse, TokenError> {
    // Check if channel exists
    // let ctl = state.ctl.lock().await;
    // let channels = ctl.channels.lock().await;
    // if !channels.contains_key(&req.channel) {
    //     error!("channel {} not found", req.channel);
    //     return Err(TokenError::ChannelNotFound);
    // }
    let id_length = state.id_length as usize;
    let id = req
        .id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| nanoid::nanoid!(id_length).to_string());

    match generate_jwt(id.clone(), req.channel.clone(), state.jwt_secret.clone(), state.jwt_expiration_secs).await {
        Ok(token) => Ok(Json(serde_json::json!({
            "id": id.clone(),
            "channel": req.channel.clone(),
            "token": token
        }))),
        Err(_) => Err(TokenError::GenerationFailed),
    }
}

#[derive(Debug, Deserialize)]
struct WebSocketParams {
    #[serde(rename = "userToken")]
    user_token: Option<String>,

    #[serde(rename = "vsn")]
    version: String,
}

async fn websocket_handler(
    ws: WebSocketUpgrade, Query(params): Query<WebSocketParams>, AxumState(state): AxumState<Arc<State>>,
) -> impl IntoResponse {
    info!("version: {}", params.version);
    ws.on_upgrade(move |socket| axum_on_connected(socket, state, params.user_token.clone()))
}

// use clap to parse command line arguments
#[derive(Debug, Deserialize, Parser)]
#[command(name = "wd", about = "channel server")]
struct Options {
    #[arg(long, env, default_value = "127.0.0.1")]
    host: Option<String>,

    #[arg(long, env, default_value = "2025")]
    port: Option<u16>,

    #[arg(long, env, default_value = None)]
    redis_url: Option<String>,

    #[arg(long, env,default_value = "8")]
    id_length: u8,

    #[arg(long, env, default_value = None)]
    jwt_secret: Option<String>,

    #[arg(long, env, default_value = "259200")]
    jwt_expiration_secs: i64,

    #[arg(long, env, default_value = "assets")]
    static_path: Option<String>,
}

async fn keepalive(state: Arc<State>) -> RedisResult<()> {
    let redis_client = state.redis_client.clone();

    let redis_topic = "from:*:heartbeat".to_string();
    let mut redis_pubsub = redis_client.get_async_pubsub().await?;
    redis_pubsub.psubscribe(redis_topic.clone()).await?;
    let mut redis_pubsub_stream = redis_pubsub.on_message();

    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));

    loop {
        tokio::select! {
            _ = interval.tick() => {}
            optional_message = redis_pubsub_stream.next() => {
                if optional_message.is_none() {
                    error!("KEEPALIVE / from redis: none");
                    continue;
                }
                // payload JSON: {"conn_id": conn_id}
                let payload = optional_message.unwrap().get_payload::<String>().unwrap();
                let value_result: serde_json::Result<serde_json::Value> = serde_json::from_str(&payload);
                if value_result.is_err() {
                    error!("KEEPALIVE / from redis: parse error: {}", payload);
                    continue;
                }
                if let Some(conn_id) = value_result.unwrap()["conn_id"].as_str() {
                    info!("KEEPALIVE / heartbeat {:?}", conn_id);
                }
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // dotenv::dotenv().ok(); // load .env if possible

    // Set tracing to use EnvFilter
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_span_events(FmtSpan::CLOSE)
        .init();

    let options = Options::parse(); // exit on error
    if options.redis_url.is_none() {
        error!("redis_url is missing");
        return Ok(());
    }

    let redis_url = options.redis_url.unwrap();
    let redis_client = Client::open(redis_url.clone())?;
    let channel_control = ChannelControl::new(Arc::new(redis_client.clone()));

    let jwt_secret = options.jwt_secret.unwrap_or_else(|| {
        let random_secret = random_string(8);
        warn!("no secret provided, generated: {}", random_secret);
        random_secret
    });

    info!("JWT default expiration: {} seconds / {} day(s)", options.jwt_expiration_secs, options.jwt_expiration_secs / 86400);

    let state = Arc::new(State {
        ctl: Mutex::new(channel_control),
        redis_client,
        id_length: options.id_length,
        jwt_secret, // Get from command line, environment variable, or generate a random one
        jwt_expiration_secs: options.jwt_expiration_secs, // default: 3 days
    });

    tokio::spawn(keepalive(state.clone()));

    // phoenix & admin are special
    add_channel(&state.ctl, "phoenix".into()).await;
    launch_channel_redis_listen_task(state.clone(), &state.ctl, "phoenix".into(), state.redis_client.clone()).await;

    add_channel(&state.ctl, "admin".into()).await;
    launch_channel_redis_listen_task(state.clone(), &state.ctl, "admin".into(), state.redis_client.clone()).await;

    // predefined channel
    add_channel(&state.ctl, "system".into()).await;
    launch_channel_redis_listen_task(state.clone(), &state.ctl, "system".into(), state.redis_client.clone()).await;

    tokio::spawn(datetime_handler(state.clone(), "system".into()));

    let host = options.host.unwrap();
    let port = options.port.unwrap();

    let app = Router::new()
        .route("/websocket", get(websocket_handler))
        .route("/token", post(generate_token))
        .fallback_service(ServeDir::new(options.static_path.unwrap())) // Use fallback_service instead of nest_service for root path
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, port)).await.unwrap();

    info!("serving at {}:{} ...", host, port);
    axum::serve(listener, app).await.unwrap();

    Ok(())
}

use axum::{
    extract::{State as AxumState, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use channels::{
    channel::{listen_to_redis, ChannelControl},
    utils::random_string,
    websocket::{axum_on_connected, system_default_tx_handler, State},
};
use clap::Parser;
use redis::Client;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tracing::{error, info};
use tracing_subscriber::{fmt::format::FmtSpan, EnvFilter};

async fn websocket_handler(ws: WebSocketUpgrade, AxumState(state): AxumState<Arc<State>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| axum_on_connected(socket, state))
}

// use clap to parse command line arguments
#[derive(Debug, Deserialize, Parser)]
#[command(name = "wd", about = "channel server")]
struct Options {
    #[arg(long, default_value = "127.0.0.1")]
    host: Option<String>,

    #[arg(long, default_value = "5000")]
    port: Option<u16>,

    #[arg(long, default_value = None)]
    redis_url: Option<String>,

    #[arg(long, default_value = None)]
    redis_topic: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok(); // load .env if possible

    // 设置 tracing 使用 EnvFilter
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(env_filter).with_span_events(FmtSpan::CLOSE).init();

    let options = Options::parse(); // exit on error
    if options.redis_url.is_none() || options.redis_topic.is_none() {
        error!("redis_url and redis_topic must be provided");
        return Ok(());
    }

    let redis_url = options.redis_url.unwrap();

    let channel_control = ChannelControl::new();
    channel_control.channel_add("phoenix".into(), None).await;
    channel_control.channel_add("admin".into(), None).await;

    channel_control.channel_add("system".into(), None).await;
    channel_control.channel_add("streaming".into(), None).await;

    let redis_client = Client::open(redis_url.clone())?;
    let state = Arc::new(State {
        ctl: Mutex::new(channel_control),
        redis_url: redis_url.clone(),
        redis_client,
        jwt_secret: random_string(8),
    });

    tokio::spawn(system_default_tx_handler(state.clone(), "system"));

    // 并不需要一致监听，应该是有 agent subscribe 的时候才 sub 到 redis
    tokio::spawn(listen_to_redis(state.clone(), "admin".to_string()));

    tokio::spawn(listen_to_redis(state.clone(), "system".to_string()));
    tokio::spawn(listen_to_redis(state.clone(), "streaming".to_string()));

    let host = options.host.unwrap(); // .parse::<std::net::IpAddr>().unwrap();
    let port = options.port.unwrap();

    let app = Router::new()
        .route("/websocket", get(websocket_handler))
        .nest_service("/", ServeDir::new("channels/src/bin")) // 需要把 html 直接包含到 binary 中，方便发布
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, port)).await.unwrap();

    info!("serving at {}:{} ...", host, port);
    axum::serve(listener, app).await.unwrap();

    Ok(())
}

use axum::{
    extract::{State as AxumState, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use clap::Parser;
use futures::StreamExt;
use redis::Client;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tower_http::services::ServeDir;
use tracing::{error, info};
use tracing_subscriber::{fmt::format::FmtSpan, EnvFilter};
use websocket_channels::{
    channel::ChannelControl,
    utils::random_string,
    websocket::{
        axum_on_connected, streaming_default_tx_handler, system_default_tx_handler, State,
    },
};

async fn subscribe_and_send(
    redis_url: String,
    redis_topic: String,
    tx: mpsc::UnboundedSender<String>,
) -> redis::RedisResult<()> {
    let client = Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(redis_topic).await?;
    let mut pubsub_stream = pubsub.on_message();
    loop {
        match pubsub_stream.next().await {
            Some(msg) => {
                let payload: String = msg.get_payload()?;
                info!("received: {}", payload);
                if tx.send(payload).is_err() {
                    error!("receiver dropped, exiting.");
                    break;
                }
            }
            None => {
                info!("PubSub connection closed, exiting.");
                break;
            }
        }
    }
    Ok(())
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<Arc<State>>,
) -> impl IntoResponse {
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
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_span_events(FmtSpan::CLOSE)
        .init();

    let options = Options::parse(); // exit on error
    if options.redis_url.is_none() || options.redis_topic.is_none() {
        error!("redis_url and redis_topic must be provided");
        return Ok(());
    }

    let redis_url = options.redis_url.unwrap();
    // let redis_topic = options.redis_topic.unwrap();

    let channel_control = ChannelControl::new();
    channel_control.channel_add("phoenix".into(), None).await;
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

    let (tx, rx) = mpsc::unbounded_channel();
    let data_source = UnboundedReceiverStream::new(rx);
    tokio::spawn(streaming_default_tx_handler(
        state.clone(),
        data_source,
        "streaming",
        "data",
    ));

    tokio::spawn(subscribe_and_send(redis_url.clone(), redis_url.clone(), tx));

    let host = options.host.unwrap(); // .parse::<std::net::IpAddr>().unwrap();
    let port = options.port.unwrap();

    let app = Router::new()
        .route("/websocket", get(websocket_handler))
        .nest_service("/", ServeDir::new("src/bin"))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, port))
        .await
        .unwrap();

    info!("serving at {}:{} ...", host, port);
    axum::serve(listener, app).await.unwrap();

    Ok(())
}

use axum::{
    extract::{State as AxumState, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use clap::Parser;
use futures::{SinkExt, StreamExt};
use redis::Client;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tower_http::services::ServeDir;
use tracing::{error, info};
use tracing_subscriber::{fmt::format::FmtSpan, EnvFilter};
use uuid::Uuid;
use websocket_channels::{
    channel::ChannelControl,
    websocket::{streaming_default_tx_task, system_default_tx_task, State as AppState},
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
    AxumState(state): AxumState<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: axum::extract::ws::WebSocket, state: Arc<AppState>) {
    let conn_id = Uuid::new_v4().to_string();
    info!("on_connected: {}", conn_id);
    state.ctl.lock().await.conn_add(conn_id.clone()).await;

    let (mut sender, mut receiver) = socket.split();

    let (_tx, mut rx) = mpsc::unbounded_channel();

    // Spawn a task for sending messages to the WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if let Err(e) = sender.send(message).await {
                error!("Error sending websocket message: {}", e);
                break;
            }
        }
    });

    // Spawn a task for receiving messages from the WebSocket
    let state_clone = state.clone();
    let conn_id_clone = conn_id.clone();
    let mut receive_task = tokio::spawn(async move {
        while let Some(result) = receiver.next().await {
            match result {
                Ok(msg) => {
                    if let Err(e) =
                        handle_websocket_message(msg, &state_clone, &conn_id_clone).await
                    {
                        error!("Error handling websocket message: {}", e);
                        break;
                    }
                }
                Err(e) => {
                    error!("Error receiving websocket message: {}", e);
                    break;
                }
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = (&mut send_task) => receive_task.abort(),
        _ = (&mut receive_task) => send_task.abort(),
    }

    state.ctl.lock().await.agent_remove(conn_id).await;
    info!("client connection closed");
}

async fn handle_websocket_message(
    _msg: axum::extract::ws::Message,
    _state: &Arc<AppState>,
    _conn_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // 实现消息处理逻辑
    // 这里需要根据您的具体需求来处理不同类型的消息
    Ok(())
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
    let state = Arc::new(AppState {
        ctl: Mutex::new(channel_control),
        redis_url: redis_url.clone(),
        redis_client,
    });

    tokio::spawn(system_default_tx_task(state.clone(), "system"));

    let (tx, rx) = mpsc::unbounded_channel();
    let data_source = UnboundedReceiverStream::new(rx);
    tokio::spawn(streaming_default_tx_task(
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

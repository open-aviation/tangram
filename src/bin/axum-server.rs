use axum::{
    extract::{State as AxumState, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};
use redis::Client;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tower_http::services::ServeDir;
use tracing::{error, info};
use tracing_subscriber::{fmt::format::FmtSpan, EnvFilter};
use uuid::Uuid;
use websocket_channels::{
    channel::ChannelControl,
    websocket::{streaming_data_task, system_datetime_task, State as AppState},
};

async fn subscribe_and_send(
    redis_url: &str,
    topic: &str,
    tx: mpsc::UnboundedSender<String>,
) -> redis::RedisResult<()> {
    let client = Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(topic).await?;
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
    state.ctl.lock().await.add_connection(conn_id.clone()).await;

    let (mut sender, mut receiver) = socket.split();

    let (tx, mut rx) = mpsc::unbounded_channel();

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

    state.ctl.lock().await.remove_agent(conn_id).await;
    info!("client connection closed");
}

async fn handle_websocket_message(
    msg: axum::extract::ws::Message,
    state: &Arc<AppState>,
    conn_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // 实现消息处理逻辑
    // 这里需要根据您的具体需求来处理不同类型的消息
    Ok(())
}

#[tokio::main]
async fn main() {
    // 设置 tracing 使用 EnvFilter
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_span_events(FmtSpan::CLOSE)
        .init();

    let channel_control = ChannelControl::new();
    channel_control.new_channel("phoenix".into(), None).await;
    channel_control.new_channel("system".into(), None).await;
    channel_control.new_channel("streaming".into(), None).await;

    let state = Arc::new(AppState {
        ctl: Mutex::new(channel_control),
    });

    tokio::spawn(system_datetime_task(state.clone(), "system"));

    let (tx, rx) = mpsc::unbounded_channel();
    let data_source = UnboundedReceiverStream::new(rx);
    tokio::spawn(streaming_data_task(
        state.clone(),
        data_source,
        "streaming",
        "data",
    ));

    tokio::spawn(subscribe_and_send(
        "redis://192.168.8.37:6379/0",
        "streaming:data",
        tx,
    ));

    let app = Router::new()
        .route("/websocket", get(websocket_handler))
        .nest_service("/", ServeDir::new("src/bin"))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("0.0.0.0:5000").await.unwrap();

    info!("serving at :5000 ...");
    axum::serve(listener, app).await.unwrap();
}

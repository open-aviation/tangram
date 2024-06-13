use std::fmt::{Display, Error};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Extension, Router};
use futures::{sink::SinkExt, stream::StreamExt};
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tracing::{debug, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
// use tracing::log::info;

use serde::{Deserialize, Serialize};
use serde_tuple::{Deserialize_tuple, Serialize_tuple};
use uuid::Uuid;

use websocket_channels::ChannelManager;

// Channel
//
// - join
// > [join_ref, ref, topic, 'phx_join', payload]
// < [join_ref, ref, topic, 'phx_reply', {"status": "ok"}]
//
// - leave
// > [join_ref, ref, topic, 'phx_leave', payload]
// < [join_ref, ref, topic, 'phx_reply', {"status": "ok"}]
//
// - heartbeat
// > [join_ref, ref, 'phoenix', 'heartbeat', payload]
// < [join_ref, ref, topic, 'phx_reply', payload]
//

struct User {
    user_id: String,
    session_id: i32,
}

// enum MyMessage {
//     String,
// }

struct State {
    channels: Mutex<ChannelManager<String>>, // String: message type, TODO customize this
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let channels = ChannelManager::new();
    channels.new_channel("phoenix".into(), None).await; // channel for server to publish heartbeat
    channels.new_channel("system".into(), None).await;

    let assets_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("examples")
        .join("assets");

    let state = Arc::new(State {
        channels: Mutex::new(channels),
    });

    let app = Router::new()
        .fallback_service(ServeDir::new(assets_dir).append_index_html_on_directories(true))
        .route("/websocket", get(websocket_handler))
        .layer(Extension(state.clone()));

    let local_state = state.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

        info!("launch datetime thread ...");
        let mut counter = 0;
        loop {
            let now = chrono::Local::now();
            let message = ChannelMessage {
                join_reference: None,
                reference: counter.to_string(),
                topic: "system".to_string(),
                event: "datetime".to_string(),
                payload: Payload::Reply {
                    status: "ok".to_string(),
                    response: Response::DatetimeReesponse {
                        datetime: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
                        counter,
                    },
                },
            };
            let text = serde_json::to_string(&message).unwrap();
            local_state
                .channels
                .lock()
                .await
                .broadcast("system".to_string(), text.clone())
                .await
                .unwrap();
            debug!("datetime > {}", text);
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            counter += 1;
        }
    });

    let listener = tokio::net::TcpListener::bind("0.0.0.0:5000").await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

// TODO handle header
async fn websocket_handler(
    ws: WebSocketUpgrade,
    Extension(state): Extension<Arc<State>>,
) -> impl IntoResponse {
    // TODO drop the connection if `userToken` in query string is not valid
    ws.on_upgrade(|socket| websocket(socket, state))
}

#[derive(Debug, Serialize, Deserialize)]
struct JoinPayload {
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct JoinReply {
    status: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct LeaveRequest {}

#[derive(Debug, Serialize, Deserialize)]
struct HeartbeatRequest {}

#[derive(Debug, Serialize, Deserialize)]
struct HeartbeatReply {}

#[derive(Debug, Serialize, Deserialize)]
struct EmptyResponse {}

#[derive(Debug, Serialize, Deserialize)]
struct DatetimeResponse {
    datetime: String,
    counter: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Response {
    DatetimeReesponse { datetime: String, counter: u32 },
    EmptyResponse {},
}

#[derive(Debug, Serialize, Deserialize)]
struct Reply {
    status: String,
    response: Response,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Payload {
    JoinRequest { token: String },
    JoinReply { status: String },
    LeaveRequest {},
    Reply { status: String, response: Response },
}

#[derive(Debug, Serialize_tuple, Deserialize_tuple)]
struct ChannelMessage {
    join_reference: Option<String>, // null when it's heartbeat
    reference: String,
    topic: String, // `channel`
    event: String,
    payload: Payload, // TODO
}

impl Display for ChannelMessage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> Result<(), Error> {
        write!(
            formatter,
            "<ChannelMessage: join_ref={:?}, ref={}, topic={}, event={}>",
            self.join_reference, self.reference, self.topic, self.event
        )
    }
}

async fn send_ok(
    join_reference: Option<String>,
    reference: &str,
    channel: &str,
    state: Arc<State>,
) {
    let join_reply = ChannelMessage {
        join_reference: join_reference.clone(),
        reference: reference.to_string(),
        topic: channel.to_string(),
        event: "phx_reply".to_string(),
        payload: Payload::JoinReply {
            status: "ok".into(),
        },
    };
    let text = serde_json::to_string(&join_reply).unwrap();
    state
        .channels
        .lock()
        .await
        .broadcast(channel.to_string(), text.clone())
        .await
        .unwrap();
    debug!("> {}", text);
}

async fn handle_incoming_messages(received_text: String, state: Arc<State>, user_id: &str) {
    debug!("< {}", received_text);

    let received_message: ChannelMessage = serde_json::from_str(&received_text).unwrap();
    debug!("{}", received_message);

    let reference = &received_message.reference;
    let join_reference = &received_message.join_reference;
    let channel = &received_message.topic;
    let event = &received_message.event;

    if event == "phx_join" {
        state
            .channels
            .lock()
            .await
            .add_user(user_id.to_string(), None)
            .await;
        state
            .channels
            .lock()
            .await
            .join_channel("phoenix".into(), user_id.into())
            .await
            .unwrap();
        state
            .channels
            .lock()
            .await
            .join_channel(channel.clone(), user_id.to_string())
            .await
            .unwrap(); // join user to system channel
        send_ok(join_reference.clone(), reference, channel, state.clone()).await;
    }

    if event == "phx_leave" {
        state
            .channels
            .lock()
            .await
            .leave_channel(channel.clone(), user_id.to_string())
            .await
            .unwrap();
        send_ok(join_reference.clone(), reference, channel, state.clone()).await;
    }

    if channel == "phoenix" && event == "heartbeat" {
        info!("heartbeat message");
        send_ok(Option::None, reference, "phoenix", state.clone()).await;
    }
}

async fn websocket(ws: WebSocket, state: Arc<State>) {
    let (mut tx, mut rx) = ws.split();

    let user = User {
        user_id: Uuid::new_v4().to_string(),
        session_id: 0,
    };
    info!("user: {}", user.user_id);

    state
        .channels
        .lock()
        .await
        .add_user(user.user_id.to_string(), None)
        .await;

    // get receiver for user that get message from all channels
    let mut user_receiver = state
        .channels
        .lock()
        .await
        .get_user_receiver(user.user_id.to_string())
        .await
        .unwrap();

    // channels => websocket client
    let mut tx_task = tokio::spawn(async move {
        while let Ok(my_message) = user_receiver.recv().await {
            tx.send(Message::Text(my_message)).await.unwrap();
        }
    });

    // spawn a task to get message from user and handle things
    let rec_state = state.clone();
    let mut rx_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(received_text))) = rx.next().await {
            handle_incoming_messages(received_text, rec_state.clone(), &user.user_id.clone()).await;
        }
    });

    tokio::select! {
        _ = (&mut tx_task) => rx_task.abort(),
        _ = (&mut rx_task) => tx_task.abort(),
    }

    state
        .channels
        .lock()
        .await
        .remove_user(user.session_id.to_string())
        .await;
    info!("client connection closed");
}

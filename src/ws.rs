use futures::SinkExt;
use futures::StreamExt;
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use serde_tuple::{Deserialize_tuple, Serialize_tuple};
use std::fmt::{Display, Error};
use std::sync::Arc;
use tokio::sync::Mutex;

use uuid::Uuid;
use warp::ws::Message;
use warp::ws::WebSocket;

use crate::ChannelManager;

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

pub struct State {
    pub channels: Mutex<ChannelManager<String>>, // String: message type, TODO customize this
}

pub struct User {
    user_id: String,
    session_id: i32,
}

impl Default for User {
    fn default() -> Self {
        User {
            user_id: Uuid::new_v4().to_string(),
            session_id: 0,
        }
    }
}

// #[derive(Debug, Serialize, Deserialize)]
// struct EmptyResponse {}
//
// #[derive(Debug, Serialize, Deserialize)]
// struct HeartbeatResponse {}
//
// #[derive(Debug, Serialize, Deserialize)]
// struct JoinResponse {}
//
// #[derive(Debug, Serialize, Deserialize)]
// struct LeaveResponse {}
//
// #[derive(Debug, Serialize, Deserialize)]
// struct DatetimeResponse {
//     datetime: String,
//     counter: u32,
// }

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Response {
    Empty {},
    Heartbeat {},
    Join {},
    Leave {},
    Datetime { datetime: String, counter: u32 },
}

#[derive(Debug, Serialize, Deserialize)]
struct ReplyPayload {
    status: String,
    response: Response,
}

#[derive(Debug, Serialize_tuple, Deserialize_tuple)]
struct ReplyTuple {
    join_reference: Option<String>, // null when it's heartbeat
    reference: String,
    topic: String, // `channel`
    event: String,
    payload: ReplyPayload, // TODO
}

impl Display for ReplyTuple {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> Result<(), Error> {
        write!(
            formatter,
            "<ReplyTuple: join_ref={:?}, ref={}, topic={}, event={}>",
            self.join_reference, self.reference, self.topic, self.event
        )
    }
}

/// request data structures
#[derive(Debug, Serialize, Deserialize)]
struct JoinRequest {
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct LeaveRequest {}

#[derive(Debug, Serialize, Deserialize)]
struct HeartbeatRequest {}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum RequestPayload {
    Join { token: String },
    Leave {},
    Heartbeat {},
}

#[derive(Debug, Serialize_tuple, Deserialize_tuple)]
struct RequestTuple {
    join_reference: Option<String>, // null when it's heartbeat
    reference: String,
    topic: String, // `channel`
    event: String,
    payload: RequestPayload, // TODO
}

impl Display for RequestTuple {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> Result<(), Error> {
        write!(
            formatter,
            "<RequestTuple: join_ref={:?}, ref={}, topic={}, event={}>",
            self.join_reference, self.reference, self.topic, self.event
        )
    }
}

pub async fn on_connected(ws: WebSocket, state: Arc<State>) {
    let (mut tx, mut rx) = ws.split();

    let user = User::default();
    info!("user: {} connected", user.user_id);

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
            tx.send(Message::text(my_message)).await.unwrap();
        }
    });

    // spawn a task to get message from user and handle things
    let rec_state = state.clone();
    let mut rx_task = tokio::spawn(async move {
        while let Some(result) = rx.next().await {
            if let Ok(message) = result {
                if message.is_text() {
                    handle_incoming_messages(
                        message.to_str().unwrap().to_string(),
                        rec_state.clone(),
                        &user.user_id.clone(),
                    )
                    .await;
                }
            };
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

pub async fn handle_incoming_messages(received_text: String, state: Arc<State>, user_id: &str) {
    debug!("< {}", received_text);

    let received_message: RequestTuple = serde_json::from_str(&received_text).unwrap();
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

/// send_ok sends a `ok` reply message to the channel
pub async fn send_ok(
    join_reference: Option<String>,
    reference: &str,
    channel: &str,
    state: Arc<State>,
) {
    let join_reply = ReplyTuple {
        join_reference: join_reference.clone(),
        reference: reference.to_string(),
        topic: channel.to_string(),
        event: "phx_reply".to_string(),
        payload: ReplyPayload {
            status: "ok".into(),
            response: Response::Empty {},
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

/// datetime_task is a task that sends datetime event to the system channel every second
pub async fn datetime_task(state: Arc<State>, channel_name: &str) {
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

    info!("launch datetime thread ...");
    let mut counter = 0;
    let event = "datetime";
    loop {
        let now = chrono::Local::now();
        let message = ReplyTuple {
            join_reference: None,
            reference: counter.to_string(),
            topic: channel_name.to_string(),
            event: event.to_string(),
            payload: ReplyPayload {
                status: "ok".to_string(),
                response: Response::Datetime {
                    datetime: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
                    counter,
                },
            },
        };
        let text = serde_json::to_string(&message).unwrap();
        match state
            .channels
            .lock()
            .await
            .broadcast(channel_name.to_string(), text.clone())
            .await
        {
            // Ok(0) => debug!("no user in the system channel"),
            // Ok(_) => debug!("datetime > {}", text),
            Ok(_) => {}
            Err(e) => error!("fail to send `datetime` event to `system` channel, {}", e),
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        counter += 1;
    }
}

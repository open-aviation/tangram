#![allow(unused)]

use std::{path::PathBuf, sync::Arc};

use futures::{sink::SinkExt, stream::StreamExt};
use log::info;
use tokio::net::UdpSocket;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_tungstenite::connect_async;
use warp::ws::Message;
use warp::ws::WebSocket;
use warp::Filter;

use uuid::Uuid;
use websocket_channels::channel::ChannelControl;
use websocket_channels::websocket::{jet1090_data_task, on_connected, system_datetime_task, State};

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let channel_control = ChannelControl::new();
    channel_control.new_channel("phoenix".into(), None).await; // channel for server to publish heartbeat
    channel_control.new_channel("system".into(), None).await;
    channel_control.new_channel("jet1090".into(), None).await;

    let state = Arc::new(State {
        ctl: Mutex::new(channel_control),
    });
    tokio::spawn(system_datetime_task(state.clone(), "system"));

    // rs1090 data items (TimeedMessage) are sent to timed_message_tx
    // a thread reads from timed_message_stream and relay them to channels
    let (timed_message_tx, timed_message_rx) = tokio::sync::mpsc::unbounded_channel();
    let timed_message_stream = UnboundedReceiverStream::new(timed_message_rx);
    tokio::spawn(jet1090_data_task(
        state.clone(),
        timed_message_stream,
        "jet1090",
        "data",
    ));

    let state = warp::any().map(move || state.clone());
    let ws_route =
        warp::path("websocket")
            .and(warp::ws())
            .and(state)
            .map(|ws: warp::ws::Ws, state| {
                ws.on_upgrade(move |websocket| on_connected(websocket, state))
            });
    let routes = warp::path::end()
        .and(warp::fs::file("src/bin/index.html"))
        .or(ws_route);
    warp::serve(routes).run(([0, 0, 0, 0], 5000)).await;
}

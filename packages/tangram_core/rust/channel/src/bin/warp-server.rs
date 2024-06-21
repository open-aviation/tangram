#![allow(unused)]

use std::{path::PathBuf, sync::Arc};

use futures::{sink::SinkExt, stream::StreamExt};
use log::info;
use tokio::sync::Mutex;
use warp::ws::Message;
use warp::ws::WebSocket;
use warp::Filter;

use uuid::Uuid;
use websocket_channels::{
    ws::{datetime_task, handle_incoming_messages, on_connected, State, User},
    ChannelManager,
};

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let channels = ChannelManager::new();
    channels.new_channel("phoenix".into(), None).await; // channel for server to publish heartbeat
    channels.new_channel("system".into(), None).await;
    let state = Arc::new(State {
        channels: Mutex::new(channels),
    });

    tokio::spawn(datetime_task(state.clone(), "system"));

    let index = warp::path::end().and(warp::fs::file("src/bin/index.html"));

    let state = warp::any().map(move || state.clone());
    let ws_route = warp::path("websocket")
        // The `ws()` filter will prepare Websocket handshake...
        .and(warp::ws())
        .and(state)
        .map(|ws: warp::ws::Ws, state| {
            ws.on_upgrade(move |websocket| on_connected(websocket, state))
        });
    let routes = index.or(ws_route);
    warp::serve(routes).run(([127, 0, 0, 1], 5000)).await;
}

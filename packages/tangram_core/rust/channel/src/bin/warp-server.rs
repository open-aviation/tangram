#![allow(unused)]

use std::{path::PathBuf, sync::Arc};

use futures::{sink::SinkExt, stream::StreamExt};
use log::info;
use rs1090::decode;
use rs1090::decode::TimedMessage;
use rs1090::decode::DF::{ExtendedSquitterADSB, ExtendedSquitterTisB};
use rs1090::prelude::DekuContainerRead;
use rs1090::source::radarcape;
use tokio::net::UdpSocket;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::connect_async;
use warp::ws::Message;
use warp::ws::WebSocket;
use warp::Filter;

use uuid::Uuid;
use websocket_channels::{
    websocket::{datetime_task, handle_incoming_messages, on_connected, State, User},
    ChannelControl,
};

/// this subscribe to binary data from a websocket and send it to a local udp server
/// we could just implement this int `Source::receiver`
async fn websocket_client() {
    let websocket_url = "ws://51.158.72.24:1234/42125@LFBO";
    let local_udp = "127.0.0.1:42125"; // you have to specify a source like 127.0.0.1:42125@LFBO

    loop {
        // create a UDP client socket
        // put all things in a loop to retry in case of failure
        let udp_socket = UdpSocket::bind("0.0.0.0:0").await.unwrap();
        match udp_socket.connect(local_udp).await {
            Ok(_) => {}
            Err(err) => {
                info!(
                    "failed to connect to udp://{}, {:?}, retry in 1 second(s)",
                    local_udp, err
                );
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        }

        // connect to the websocket data source
        let (websocket_stream, _) = connect_async(websocket_url)
            .await
            .expect("fail to connect to websocket endpoint");
        info!("connected to {}", websocket_url);

        // just receive data from the websocket and send it to the udp server
        let (_, websocket_rx) = websocket_stream.split();
        websocket_rx
            .for_each(|message| async {
                let raw_bytes = message.unwrap().into_data();
                udp_socket.send(&raw_bytes).await.unwrap();
                // debug!("raw data sent, size: {:?}", raw_bytes.len());
            })
            .await;
    }
}

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let channels = ChannelControl::new();
    channels.new_channel("phoenix".into(), None).await; // channel for server to publish heartbeat
    channels.new_channel("system".into(), None).await;
    let state = Arc::new(State {
        channels: Mutex::new(channels),
    });

    tokio::spawn(datetime_task(state.clone(), "system"));

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

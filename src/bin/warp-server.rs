#![allow(unused)]

use std::{path::PathBuf, sync::Arc};

use futures::{sink::SinkExt, stream::StreamExt};
use redis::aio::PubSub;
use redis::Client;
use tokio::net::UdpSocket;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_tungstenite::connect_async;
use tracing::{debug, error, info};
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::EnvFilter;
use warp::ws::Message;
use warp::ws::WebSocket;
use warp::Filter;

use uuid::Uuid;
use websocket_channels::channel::ChannelControl;
use websocket_channels::websocket::{
    on_connected, streaming_data_task, system_datetime_task, State,
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

#[tokio::main]
async fn main() {
    // 设置 tracing 使用 EnvFilter
    // RUST_LOG=redis_subscriber=debug,redis=info,tokio=warn
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_span_events(FmtSpan::CLOSE)
        .init();

    let channel_control = ChannelControl::new();
    channel_control.new_channel("phoenix".into(), None).await; // channel for server to publish heartbeat
    channel_control.new_channel("system".into(), None).await;

    // what we want is dynamic channel: user defined channel, created on demand
    channel_control.new_channel("streaming".into(), None).await;

    let state = Arc::new(State {
        ctl: Mutex::new(channel_control),
    });

    // system channel
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

    info!("serving at :5000 ...");
    warp::serve(routes).run(([0, 0, 0, 0], 5000)).await;
}

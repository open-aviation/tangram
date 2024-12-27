#![allow(unused)]

use std::{path::PathBuf, sync::Arc};

use clap::{Command, CommandFactory, Parser, ValueHint};
use futures::{sink::SinkExt, stream::StreamExt};
use redis::aio::PubSub;
use redis::Client;
use serde::Deserialize;
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
use uuid::Uuid;
use warp::ws::Message;
use warp::ws::WebSocket;
use warp::Filter;
use websocket_channels::channel::ChannelControl;
use websocket_channels::websocket::{
    on_connected, streaming_data_task, system_datetime_task, State,
};

async fn subscribe_and_send(
    redis_url: String,
    topic: String,
    tx: mpsc::UnboundedSender<String>,
) -> redis::RedisResult<()> {
    let client = Client::open(redis_url.clone())?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(topic.clone()).await?;
    let mut pubsub_stream = pubsub.on_message();

    info!("listening to redis {} pubsub: `{}` ...", redis_url, topic);
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
    // RUST_LOG=redis_subscriber=debug,redis=info,tokio=warn
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

    let redis_url = options.redis_url.unwrap();
    let redis_topic = options.redis_topic.unwrap();
    tokio::spawn(subscribe_and_send(
        redis_url.clone(),
        redis_topic.clone(),
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
    info!(
        "serving at {}:{} ...",
        options.host.unwrap(),
        options.port.unwrap()
    );
    warp::serve(routes)
        .run(([0, 0, 0, 0], options.port.unwrap()))
        .await;

    Ok(())
}

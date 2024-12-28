#![allow(unused)]

use std::{path::PathBuf, sync::Arc};

use clap::{Command, CommandFactory, Parser, ValueHint};
use futures::{sink::SinkExt, stream::StreamExt};
use redis::aio::PubSub;
use redis::{Client, RedisResult};
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
    on_connected, streaming_default_tx_task, system_default_tx_task, State,
};

async fn redis_relay(
    redis_url: String,
    redis_topic: String,
    tx: mpsc::UnboundedSender<String>,
) -> redis::RedisResult<()> {
    let redis_client = Client::open(redis_url.clone())?;

    let mut redis_pubsub = redis_client.get_async_pubsub().await?;
    redis_pubsub.subscribe(redis_topic.clone()).await?;

    let mut redis_pubsub_stream = redis_pubsub.on_message();

    info!("listening to {} pubsub: `{}` ...", redis_url, redis_topic);
    loop {
        match redis_pubsub_stream.next().await {
            Some(stream_message) => {
                let payload: String = stream_message.get_payload()?;
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

    let redis_url = options.redis_url.unwrap();
    let redis_topic = options.redis_topic.unwrap();

    let channel_control = ChannelControl::new();

    // create channels
    channel_control.channel_add("phoenix".into(), None).await; // channel for server to publish heartbeat
    channel_control.channel_add("system".into(), None).await; // system channel
    channel_control.channel_add("streaming".into(), None).await; // streaming channel

    let redis_client = Client::open(redis_url.clone())?;

    let mut redis_connection = redis_client.get_multiplexed_async_connection().await?;
    let result: RedisResult<String> = redis::cmd("PING").query_async(&mut redis_connection).await;
    info!("ping result: {:?}", result);

    // shared state among channels, used by websocket
    let state = Arc::new(State {
        ctl: Mutex::new(channel_control),
        redis_url: redis_url.clone(),
        redis_client,
    });

    // system channel
    tokio::spawn(system_default_tx_task(state.clone(), "system"));

    // streaming channel
    let (tx, rx) = mpsc::unbounded_channel();
    let data_source = UnboundedReceiverStream::new(rx);
    tokio::spawn(streaming_default_tx_task(
        state.clone(),
        data_source,
        "streaming",
        "data",
    ));

    // publish 到 redis_topic 的会被转发到 streaming:data chnnel
    tokio::spawn(redis_relay(redis_url, redis_topic, tx));

    // websocket state
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

    let host = options.host.unwrap().parse::<std::net::IpAddr>().unwrap();
    let port = options.port.unwrap();

    info!("serving at {}:{} ...", host, port);
    warp::serve(routes).run((host, options.port.unwrap())).await;

    Ok(())
}

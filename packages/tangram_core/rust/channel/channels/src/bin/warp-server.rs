#![allow(unused)]

use std::{path::PathBuf, sync::Arc};

use clap::{Command, CommandFactory, Parser, ValueHint};
use futures::{sink::SinkExt, stream::StreamExt};
use jsonwebtoken::{encode, EncodingKey, Header};
use rand::distributions::Alphanumeric;
use rand::{thread_rng, Rng};
use redis::aio::PubSub;
use redis::{Client, RedisResult};
use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_tungstenite::connect_async;
use tracing::{debug, error, info, warn};
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;
use warp::ws::Message;
use warp::ws::WebSocket;
use warp::Filter;
use channels::channel::ChannelControl;
use channels::websocket::{system_default_tx_handler, warp_on_connected, State};

#[derive(Debug, Serialize, Deserialize)]
struct TokenRequest {
    channel: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    id: String,
    channel: String,
    exp: usize,
}

#[derive(Debug)]
enum TokenError {
    ChannelNotFound,
    GenerationFailed,
}

impl warp::reject::Reject for TokenError {}

async fn generate_token(req: TokenRequest, state: Arc<State>) -> Result<impl warp::Reply, warp::Rejection> {
    // Check if channel exists
    let ctl = state.ctl.lock().await;
    let channels = ctl.channels.lock().await;
    if !channels.contains_key(&req.channel) {
        return Err(warp::reject::custom(TokenError::ChannelNotFound));
    }

    let id = Uuid::new_v4().to_string();
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        id,
        channel: req.channel,
        exp: expiration,
    };

    let key = EncodingKey::from_secret(state.jwt_secret.as_bytes());

    match encode(&Header::default(), &claims, &key) {
        Ok(token) => Ok(warp::reply::json(&serde_json::json!({
            "token": token
        }))),
        Err(_) => Err(warp::reject::custom(TokenError::GenerationFailed)),
    }
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

    #[arg(long, default_value = None)]
    jwt_secret: Option<String>,
}

fn random_string(length: usize) -> String {
    thread_rng().sample_iter(&Alphanumeric).take(length).map(char::from).collect()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok(); // load .env if possible

    // 设置 tracing 使用 EnvFilter
    // RUST_LOG=redis_subscriber=debug,redis=info,tokio=warn
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt().with_env_filter(env_filter).with_span_events(FmtSpan::CLOSE).init();

    let options = Options::parse(); // exit on error
    if options.redis_url.is_none() || options.redis_topic.is_none() {
        error!("redis_url and redis_topic must be provided");
        return Ok(());
    }

    let redis_url = options.redis_url.unwrap();
    let redis_topic = options.redis_topic.unwrap();

    let jwt_secret = options.jwt_secret.unwrap_or_else(|| {
        let generate_jwt_secret = random_string(8);
        warn!("no secret proviced, generated: {}", generate_jwt_secret);
        generate_jwt_secret
    });

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
        jwt_secret,
    });

    // system channel
    tokio::spawn(system_default_tx_handler(state.clone(), "system"));

    let state_for_ws = state.clone();
    let ws_route = warp::path("websocket")
        .and(warp::ws())
        .and(warp::any().map(move || state_for_ws.clone()))
        .map(|ws: warp::ws::Ws, state| ws.on_upgrade(move |websocket| warp_on_connected(websocket, state)));

    // let state_for_token = state.clone();
    // let token_route = warp::path("token")
    //     .and(warp::get())
    //     .and(warp::any().map(move || state_for_token.clone()))
    //     .and_then(generate_token);

    // Rename the route variable and update the path
    let state_for_channel_token = state.clone();
    let channel_token_route = warp::path("token")
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::any().map(move || state_for_channel_token.clone()))
        .and_then(generate_token);

    let routes = warp::path::end().and(warp::fs::file("src/bin/index.html")).or(ws_route).or(channel_token_route);

    let host = options.host.unwrap().parse::<std::net::IpAddr>().unwrap();
    let port = options.port.unwrap();

    info!("serving at {}:{} ...", host, port);
    warp::serve(routes).run((host, options.port.unwrap())).await;

    Ok(())
}

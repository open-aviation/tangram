mod aircraftdb;
mod bbox;
mod state;
mod stream;

use crate::bbox::BoundingBoxState;
use crate::state::StateVectors;
use crate::stream::{start_jet1090_subscriber, start_redis_subscriber, stream_statevectors};
use anyhow::{Context, Result};
use clap::Parser;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

// Command-line arguments
#[derive(Parser, Debug)]
#[clap(author, version, about = "Aircraft data streaming service")]
struct Args {
    /// Redis URL
    #[clap(long, env = "REDIS_URL", default_value = "redis://redis:6379")]
    redis_url: String,

    /// Redis channel for Jet1090 messages
    #[clap(long, env = "JET1090_CHANNEL", default_value = "jet1090")]
    jet1090_channel: String,

    /// Expire aircraft after (in seconds)
    #[clap(long, env = "EXPIRE_AIRCRAFT", default_value = "1200", short = 'x')]
    history_expire: u16,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables from a .env file
    dotenv::dotenv().ok();

    // Initialize tracing instead of env_logger
    let file_appender = tracing_appender::rolling::daily("/tmp/tangram", "planes.log");
    let (_non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Setup the subscriber with both console and file logging
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .with_writer(std::io::stdout)
        .init();

    // Parse command line arguments
    let args = Args::parse();

    // Spawn Redis subscribers
    let redis_url = args.redis_url.clone();
    let bbox_state = Arc::new(Mutex::new(BoundingBoxState::new()));
    let bbox_subscriber_state = Arc::clone(&bbox_state);
    let bbox_subscriber_handle = tokio::spawn(async move {
        match start_redis_subscriber(redis_url, bbox_subscriber_state).await {
            Ok(_) => info!("BoundingBox subscriber stopped normally"),
            Err(e) => error!("BoundingBox subscriber error: {}", e),
        }
    });

    let redis_url = args.redis_url.clone();
    let jet1090_channel = args.jet1090_channel.clone();
    let expire = args.history_expire;
    let client = redis::Client::open(redis_url.clone())
        .context("Failed to create Redis client for state vectors")?;
    let state_vectors = Arc::new(Mutex::new(StateVectors::new(expire, client).await));
    let jet1090_subscriber_state = Arc::clone(&state_vectors);
    let jet1090_subscriber_handle = tokio::spawn(async move {
        match start_jet1090_subscriber(redis_url, jet1090_channel, jet1090_subscriber_state).await {
            Ok(_) => info!("Jet1090 subscriber stopped normally"),
            Err(e) => error!("Jet1090 subscriber error: {}", e),
        }
    });

    // Start main streaming task
    let streaming_handle = tokio::spawn(async move {
        match stream_statevectors(args.redis_url, bbox_state, state_vectors).await {
            Ok(_) => info!("Streaming task stopped normally"),
            Err(e) => error!("Streaming task error: {}", e),
        }
    });

    // Wait for tasks to complete
    tokio::select! {
        _ = bbox_subscriber_handle => {
            error!("BoundingBox subscriber task exited unexpectedly");
        }
        _ = jet1090_subscriber_handle => {
            error!("Jet1090 subscriber task exited unexpectedly");
        }
        _ = streaming_handle => {
            error!("Streaming task exited unexpectedly");
        }
    }

    Ok(())
}

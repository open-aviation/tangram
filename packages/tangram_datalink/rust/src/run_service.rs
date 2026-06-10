use crate::{state::DatalinkStateVectors, state::DecodedEvent, DatalinkConfig};
use futures::StreamExt;
use redis::AsyncCommands;
use std::sync::Arc;
use tangram_core::bbox::BoundingBoxState;
use tangram_core::shutdown::Shutdown;
use tangram_core::stream::{start_redis_subscriber, stream_statevectors, StreamConfig};
use tokio::sync::{watch, Mutex};
use tracing::{error, warn};

pub async fn datalink_redis_subscriber(
    redis_url: String,
    state_vectors: Arc<Mutex<DatalinkStateVectors>>,
    mut shutdown: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let client = redis::Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.psubscribe("datalink-*").await?;
    let mut publisher = None;

    let mut stream = pubsub.on_message();
    loop {
        tokio::select! {
            msg = stream.next() => {
                let Some(msg) = msg else { break; };
                let payload: String = msg.get_payload()?;

                // HACK: tolerate duplicate `timestamp` keys for now
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
                    if let Ok(feed) = serde_json::from_value::<DecodedEvent>(value) {
                    if publisher.is_none() {
                        publisher = client.get_multiplexed_async_connection().await.ok();
                    }
                    if let Some(publisher) = publisher.as_mut() {
                        if let Ok(serialized) = serde_json::to_string(&feed) {
                            let _: Result<(), _> = publisher.publish("to:datalink:feed:message", &serialized).await;
                        }
                    }
                    let mut state = state_vectors.lock().await;
                    state.add(&feed);
                    } else {
                        warn!("Failed to parse datalink event from redis");
                    }
                } else {
                    warn!("Failed to parse datalink event from redis");
                }
            }
            _ = shutdown.changed() => break,
        }
    }
    Ok(())
}

pub async fn run_service(config: DatalinkConfig) -> anyhow::Result<()> {
    let (shutdown, shutdown_rx) = Shutdown::new();

    let state_vectors = Arc::new(Mutex::new(DatalinkStateVectors::new(
        config.state_vector_expire,
    )));
    let bbox_state = Arc::new(Mutex::new(BoundingBoxState::new()));

    let mut sub_handle = tokio::spawn(datalink_redis_subscriber(
        config.redis_url.clone(),
        state_vectors.clone(),
        shutdown.subscribe(),
    ));

    let mut bbox_handle = tokio::spawn(start_redis_subscriber(
        config.redis_url.clone(),
        bbox_state.clone(),
        shutdown_rx,
    ));

    let mut stream_handle = tokio::spawn(stream_statevectors(
        StreamConfig {
            redis_url: config.redis_url.clone(),
            stream_interval_secs: config.stream_interval_secs,
            entity_type_name: "entities".to_string(),
            entity_type: "datalink_entity".to_string(),
            broadcast_channel_suffix: "new-datalink-data".to_string(),
        },
        bbox_state,
        state_vectors.clone(),
        shutdown.subscribe(),
    ));

    let state_vectors_cleanup = state_vectors.clone();
    let mut cleanup_shutdown = shutdown.subscribe();
    let expire_secs = config.state_vector_expire as u64;
    let mut cleanup_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(expire_secs));
        loop {
            tokio::select! {
                _ = interval.tick() => {}
                _ = cleanup_shutdown.changed() => break,
            }
            if *cleanup_shutdown.borrow() {
                break;
            }
            let mut state = state_vectors_cleanup.lock().await;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            state
                .entities
                .retain(|_, entity| entity.lastseen > now.saturating_sub(expire_secs) as f64);
        }
    });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        res = &mut sub_handle => { error!("redis subscriber failed: {:?}", res); }
        res = &mut bbox_handle => { error!("bbox subscriber failed: {:?}", res); }
        res = &mut stream_handle => { error!("stream handle failed: {:?}", res); }
        res = &mut cleanup_handle => { error!("cleanup handle failed: {:?}", res); }
    }

    shutdown.trigger();
    Ok(())
}

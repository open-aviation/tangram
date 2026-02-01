use crate::protocol::ControlResponse;
use crate::HistoryProducerConfig;
use anyhow::{anyhow, Result};
use arrow_ipc::writer::{FileWriter, IpcWriteOptions, StreamWriter};
use arrow_schema::{ArrowError, Schema as ArrowSchema};
use base64::{engine::general_purpose, Engine as _};
use futures::StreamExt;
use redis::AsyncCommands;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Notify};
use tokio::time;
use tracing::{debug, error, info, instrument, warn};
use uuid::Uuid;

pub trait HistoryFrame: Send + Sync + 'static {
    fn table_schema() -> Arc<ArrowSchema>;
    fn to_record_batch(frames: &[&Self]) -> Result<arrow_array::RecordBatch>;
}

#[derive(Debug, Clone)]
pub struct HistoryClientConfig {
    pub redis_url: String,
    pub table_name: String,
    pub control_channel: String,
    pub partition_columns: Vec<String>,
    pub optimize_interval_secs: u64,
    pub optimize_target_file_size: u64,
    pub vacuum_interval_secs: u64,
    pub vacuum_retention_period_secs: Option<u64>,
    pub checkpoint_interval: u64,
}

/// Core of the "smart batcher" client, buffers history frames in-memory before
/// they are sent to redis.
///
/// An in-memory buffer with backpressure (`add` blocks when full) prevents
/// unbounded memory growth if the downstream writer task or redis is slow.
#[derive(Debug)]
pub struct HistoryBuffer<T: Send> {
    buffer: Arc<Mutex<Vec<T>>>,
    notify_buffer_drained: Arc<Notify>,
    notify_buffer_full: Arc<Notify>,
    max_buffered_rows: usize,
}

impl<T: Send> Clone for HistoryBuffer<T> {
    fn clone(&self) -> Self {
        Self {
            buffer: self.buffer.clone(),
            notify_buffer_drained: self.notify_buffer_drained.clone(),
            notify_buffer_full: self.notify_buffer_full.clone(),
            max_buffered_rows: self.max_buffered_rows,
        }
    }
}

impl<T: Send> HistoryBuffer<T> {
    pub fn new(max_buffered_rows: usize) -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            notify_buffer_drained: Arc::new(Notify::new()),
            notify_buffer_full: Arc::new(Notify::new()),
            max_buffered_rows,
        }
    }

    pub async fn add(&self, item: T) {
        loop {
            let mut buffer = self.buffer.lock().await;
            if buffer.len() < self.max_buffered_rows {
                buffer.push(item);
                return;
            }

            self.notify_buffer_full.notify_one();
            drop(buffer);
            self.notify_buffer_drained.notified().await;
        }
    }

    pub(crate) fn into_parts(self) -> (Arc<Mutex<Vec<T>>>, Arc<Notify>, Arc<Notify>) {
        (
            self.buffer,
            self.notify_buffer_drained,
            self.notify_buffer_full,
        )
    }
}

pub fn get_schema_ipc_base64<T: HistoryFrame>() -> Result<String, ArrowError> {
    let schema = T::table_schema();
    let mut schema_buffer = Vec::new();
    let options = IpcWriteOptions::default();
    let mut writer = FileWriter::try_new_with_options(&mut schema_buffer, &schema, options)?;
    writer.finish()?;
    Ok(general_purpose::STANDARD.encode(&schema_buffer))
}

#[instrument(skip(client), fields(table_name = %config.table_name))]
pub async fn register_history_table<T: HistoryFrame>(
    config: &HistoryClientConfig,
    client: &redis::Client,
) -> Result<()> {
    let sender_id = Uuid::new_v4().to_string();
    let response_channel = format!("{}:response:{}", config.control_channel, sender_id);

    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&response_channel).await?;
    let mut response_stream = pubsub.on_message();

    let schema_b64 =
        get_schema_ipc_base64::<T>().map_err(|e| anyhow!("failed to get schema: {}", e))?;
    let register_msg = serde_json::json!({
        "type": "register_table",
        "sender_id": sender_id,
        "table_name": config.table_name,
        "schema": schema_b64,
        "partition_columns": config.partition_columns,
        "optimize_interval_secs": config.optimize_interval_secs,
        "optimize_target_file_size": config.optimize_target_file_size,
        "vacuum_interval_secs": config.vacuum_interval_secs,
        "vacuum_retention_period_secs": config.vacuum_retention_period_secs,
        "checkpoint_interval": config.checkpoint_interval,
    });

    let mut conn = client.get_multiplexed_async_connection().await?;
    conn.publish::<_, _, ()>(
        &config.control_channel,
        serde_json::to_string(&register_msg)?,
    )
    .await?;

    match tokio::time::timeout(Duration::from_secs(10), response_stream.next()).await {
        Ok(Some(msg)) => {
            let payload: String = msg.get_payload()?;
            match serde_json::from_str::<ControlResponse>(&payload)? {
                ControlResponse::TableRegistered { table_uri, .. } => {
                    info!(
                        "table '{}' registered with history service at {}",
                        config.table_name, table_uri
                    );
                    Ok(())
                }
                ControlResponse::RegistrationFailed { error, .. } => {
                    Err(anyhow!("failed to register table: {}", error))
                }
                _ => Err(anyhow!("unexpected response type")),
            }
        }
        Ok(None) => Err(anyhow!("response channel closed unexpectedly")),
        Err(_) => Err(anyhow!("timed out waiting for registration response")),
    }
}

pub async fn writer_task<T: HistoryFrame>(
    redis_url: String,
    table_name: String,
    buffer: Arc<Mutex<Vec<T>>>,
    notify_buffer_drained: Arc<Notify>,
    notify_buffer_full: Arc<Notify>,
    flush_interval: Duration,
) -> Result<()> {
    let client = redis::Client::open(redis_url)?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let stream_key = format!("history:ingest:{}", table_name);
    let mut interval = time::interval(flush_interval);

    loop {
        tokio::select! {
            _ = interval.tick() => {},
            _ = notify_buffer_full.notified() => {},
        }

        let frames_to_flush = {
            let mut buffer_lock = buffer.lock().await;
            if buffer_lock.is_empty() {
                continue;
            }
            std::mem::take(&mut *buffer_lock)
        };
        notify_buffer_drained.notify_waiters();

        debug!(
            "writer task flushing {} history frames to redis stream '{}'",
            frames_to_flush.len(),
            stream_key
        );

        let batch = T::to_record_batch(&frames_to_flush.iter().collect::<Vec<_>>())?;

        let mut stream_buffer = Vec::new();
        let options = IpcWriteOptions::default();
        let mut writer =
            StreamWriter::try_new_with_options(&mut stream_buffer, &batch.schema(), options)?;
        writer.write(&batch)?;
        writer.finish()?;

        for attempt in 1..=3 {
            match redis::cmd("XADD")
                .arg(&stream_key)
                .arg("*")
                .arg("data")
                .arg(stream_buffer.as_slice())
                .query_async::<()>(&mut conn)
                .await
            {
                Ok(_) => {
                    debug!(
                        "successfully wrote {} frames to redis",
                        frames_to_flush.len()
                    );
                    break;
                }
                Err(e) => {
                    error!("failed to write to redis (attempt {}): {}", attempt, e);
                    if attempt == 3 {
                        error!("giving up on writing to redis, data lost.");
                    }
                    time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }
}

#[instrument(skip_all, fields(table_name = %history_config.table_name))]
pub async fn start_producer_service_components<T: HistoryFrame>(
    redis_url: String,
    history_config: HistoryProducerConfig,
    history_control_channel: String,
) -> Result<Option<HistoryBuffer<T>>> {
    let client = redis::Client::open(redis_url.clone())?;

    let history_client_config = HistoryClientConfig {
        redis_url,
        table_name: history_config.table_name.clone(),
        control_channel: history_control_channel,
        partition_columns: vec!["date".to_string()], // TODO: expose this
        optimize_interval_secs: history_config.optimize_interval_secs,
        optimize_target_file_size: history_config.optimize_target_file_size,
        vacuum_interval_secs: history_config.vacuum_interval_secs,
        vacuum_retention_period_secs: history_config.vacuum_retention_period_secs,
        checkpoint_interval: history_config.checkpoint_interval,
    };

    for attempt in 1..=3 {
        match register_history_table::<T>(&history_client_config, &client).await {
            Ok(_) => {
                let buffer = HistoryBuffer::<T>::new(history_config.buffer_size);
                let (buffer_arc, notify_drained, notify_full) = buffer.clone().into_parts();

                tokio::spawn(writer_task::<T>(
                    history_client_config.redis_url,
                    history_client_config.table_name,
                    buffer_arc,
                    notify_drained,
                    notify_full,
                    Duration::from_secs(history_config.flush_interval_secs),
                ));

                return Ok(Some(buffer));
            }
            Err(e) => {
                warn!(
                    "failed to register history table (attempt {}/3): {}. retrying in 5s...",
                    attempt, e
                );
                if attempt < 3 {
                    time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    }

    warn!("failed to register with history service after multiple attempts. history will be disabled for this session.");
    Ok(None)
}

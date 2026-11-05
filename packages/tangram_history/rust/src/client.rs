use crate::protocol::ControlResponse;
use crate::HistoryProducerConfig;
use anyhow::{anyhow, Result};
use arrow_ipc::writer::{FileWriter, IpcWriteOptions, StreamWriter};
use arrow_schema::{ArrowError, Schema as ArrowSchema};
use base64::{engine::general_purpose, Engine as _};
use futures::StreamExt;
use redis::AsyncCommands;
use std::sync::atomic::{AtomicU64, Ordering};
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

/// Holds a limited number of observations before they are sent to history.
///
/// If the buffer is full, drop new observations. Missing some history is acceptable.
#[derive(Debug)]
pub struct HistoryBuffer<T: Send> {
    buffer: Arc<Mutex<Vec<T>>>,
    notify_buffer_full: Arc<Notify>,
    dropped: Arc<AtomicU64>,
    max_buffered_rows: usize,
}

impl<T: Send> Clone for HistoryBuffer<T> {
    fn clone(&self) -> Self {
        Self {
            buffer: self.buffer.clone(),
            notify_buffer_full: self.notify_buffer_full.clone(),
            dropped: self.dropped.clone(),
            max_buffered_rows: self.max_buffered_rows,
        }
    }
}

impl<T: Send> HistoryBuffer<T> {
    pub fn new(max_buffered_rows: usize) -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            notify_buffer_full: Arc::new(Notify::new()),
            dropped: Arc::new(AtomicU64::new(0)),
            max_buffered_rows,
        }
    }

    pub async fn add(&self, item: T) {
        let mut buffer = self.buffer.lock().await;
        if buffer.len() >= self.max_buffered_rows {
            let dropped = self.dropped.fetch_add(1, Ordering::Relaxed) + 1;
            if dropped.is_power_of_two() {
                warn!(
                    dropped,
                    "History buffer full; dropping observations to protect live data"
                );
            }
            self.notify_buffer_full.notify_one();
            return;
        }
        buffer.push(item);
        if buffer.len() == self.max_buffered_rows {
            self.notify_buffer_full.notify_one();
        }
    }

    pub(crate) fn into_parts(self) -> (Arc<Mutex<Vec<T>>>, Arc<Notify>) {
        (self.buffer, self.notify_buffer_full)
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

// if the history service stops or falls behind, discard older batches
// instead of letting them accumulate in memory.
const HISTORY_STREAM_MAX_BATCHES: usize = 16;
const HISTORY_CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const HISTORY_REGISTER_RETRY_DELAY: Duration = Duration::from_secs(5);

pub async fn writer_task<T: HistoryFrame>(
    redis_url: String,
    table_name: String,
    buffer: Arc<Mutex<Vec<T>>>,
    notify_buffer_full: Arc<Notify>,
    flush_interval: Duration,
) -> Result<()> {
    let client = redis::Client::open(redis_url)?;
    let mut conn = None;
    let stream_key = format!("history:ingest:{}", table_name);
    let mut interval = time::interval(flush_interval);

    loop {
        tokio::select! {
            _ = interval.tick() => {},
            _ = notify_buffer_full.notified() => {},
        }

        let frames = {
            let mut buffered = buffer.lock().await;
            if buffered.is_empty() {
                continue;
            }
            std::mem::take(&mut *buffered)
        };
        let encoded = (|| {
            let batch = T::to_record_batch(&frames.iter().collect::<Vec<_>>())?;
            let mut bytes = Vec::new();
            {
                let mut writer = StreamWriter::try_new_with_options(
                    &mut bytes,
                    &batch.schema(),
                    IpcWriteOptions::default(),
                )?;
                writer.write(&batch)?;
                writer.finish()?;
            }
            Ok::<_, anyhow::Error>(bytes)
        })();
        let bytes = match encoded {
            Ok(bytes) => bytes,
            Err(e) => {
                warn!(%e, rows = frames.len(), "Dropping history: failed to encode batch");
                continue;
            }
        };

        // NOTE: intentionally *not* a reliable producer.
        // if redis is down, discard the batch and try again at the next flush.
        // don't retry indefinitely (as it would fill the receiver buffer)
        if conn.is_none() {
            match time::timeout(
                HISTORY_CONNECT_TIMEOUT,
                client.get_multiplexed_async_connection(),
            )
            .await
            {
                Ok(Ok(connected)) => conn = Some(connected),
                outcome => {
                    warn!(
                        ?outcome,
                        rows = frames.len(),
                        "Dropping history: Redis unavailable"
                    );
                    continue;
                }
            }
        }
        let result: redis::RedisResult<String> = redis::cmd("XADD")
            .arg(&stream_key)
            .arg("MAXLEN")
            .arg("=")
            .arg(HISTORY_STREAM_MAX_BATCHES)
            .arg("*")
            .arg("data")
            .arg(bytes.as_slice())
            .query_async(conn.as_mut().expect("connected above"))
            .await;
        match result {
            Ok(id) => debug!(rows = frames.len(), %id, "History batch staged"),
            Err(e) => {
                warn!(%e, rows = frames.len(), "Dropping history: Redis write failed");
                conn = None;
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

    // history service may start after the receiver, keep trying to register
    // in the background, so when it returns, resume recording
    loop {
        match register_history_table::<T>(&history_client_config, &client).await {
            Ok(()) => {
                let buffer = HistoryBuffer::<T>::new(history_config.buffer_size);
                let (buffer_arc, notify_full) = buffer.clone().into_parts();

                tokio::spawn(async move {
                    if let Err(e) = writer_task::<T>(
                        history_client_config.redis_url,
                        history_client_config.table_name,
                        buffer_arc,
                        notify_full,
                        Duration::from_secs(history_config.flush_interval_secs),
                    )
                    .await
                    {
                        error!(%e, "History producer stopped");
                    }
                });

                return Ok(Some(buffer));
            }
            Err(e) => {
                warn!(%e, "History service unavailable; retrying registration");
                time::sleep(HISTORY_REGISTER_RETRY_DELAY).await;
            }
        }
    }
}

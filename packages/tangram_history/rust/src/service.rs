use crate::protocol::{ControlMessage, ControlResponse, RegisterTable};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use dashmap::DashMap;
use deltalake::arrow::datatypes::Schema as ArrowSchema;
use deltalake::arrow::ipc::reader::{FileReader, StreamReader};
use deltalake::kernel::engine::arrow_conversion::TryIntoKernel;
use deltalake::kernel::StructField;
use deltalake::operations::create::CreateBuilder;
use deltalake::{DeltaOps, DeltaTable, DeltaTableBuilder, DeltaTableError};
use futures::StreamExt;
use redis::AsyncCommands;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{self, Instant};
use tracing::{error, info};
use uuid::Uuid;

fn decode_schema(base64_schema: &str) -> Result<Arc<ArrowSchema>> {
    let schema_bytes = general_purpose::STANDARD.decode(base64_schema)?;
    let cursor = Cursor::new(schema_bytes);
    let schema_reader = FileReader::try_new(cursor, None)?;
    Ok(schema_reader.schema())
}

#[derive(Debug, Clone)]
pub struct MaintenanceConfig {
    pub optimize_interval: Duration,
    pub optimize_target_file_size: u64,
    pub vacuum_interval: Duration,
    pub vacuum_retention_period_secs: Option<u64>,
}

struct ManagedTable {
    table: Arc<Mutex<DeltaTable>>,
    maintenance_config: MaintenanceConfig,
    last_optimize: Arc<Mutex<Instant>>,
    last_vacuum: Arc<Mutex<Instant>>,
    maintenance_lock: Arc<RwLock<()>>,
}

/// Central state of the history service.
///
/// This enables multiple `consume_stream_for_table` tasks for different tables
/// to run concurrently without blocking each other.
type ManagedTables = DashMap<String, ManagedTable>;

/// Listens for commands to manage tables.
/// On table registration, vacant is used to ensure only one consumer task
/// is spawned per table, even if multiple registration requests arrive.
/// Table metadata is persisted in redis with `SADD` and `HSET` so the service
/// can recover its state on resume consumption.
async fn control_subscriber(
    redis_url: String,
    channel: String,
    manager: Arc<ManagedTables>,
    base_path: String,
    redis_read_count: usize,
    redis_read_block_ms: usize,
) -> Result<()> {
    let client = redis::Client::open(redis_url.clone()).context("failed to create redis client")?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;
    info!("control subscriber listening on '{}'", channel);

    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        let payload: String = msg.get_payload()?;
        match serde_json::from_str::<ControlMessage>(&payload) {
            Ok(ControlMessage::Ping { sender }) => {
                let pong = ControlResponse::Pong { sender };
                let _: Result<(), _> = redis::cmd("PUBLISH")
                    .arg(&channel)
                    .arg(serde_json::to_string(&pong)?)
                    .query_async(&mut conn)
                    .await;
            }
            Ok(ControlMessage::RegisterTable(RegisterTable {
                sender_id,
                table_name,
                schema,
                partition_columns,
                optimize_interval_secs,
                optimize_target_file_size,
                vacuum_interval_secs,
                vacuum_retention_period_secs,
            })) => {
                let response_channel = format!("{}:response:{}", channel, sender_id);
                let response = if let Ok(arrow_schema) = decode_schema(&schema) {
                    let maintenance_config = MaintenanceConfig {
                        optimize_interval: Duration::from_secs(optimize_interval_secs),
                        optimize_target_file_size,
                        vacuum_interval: Duration::from_secs(vacuum_interval_secs),
                        vacuum_retention_period_secs,
                    };

                    let config_key = format!("history:config:{}", table_name);
                    let config_values: Vec<(&str, String)> = vec![
                        ("schema", schema),
                        (
                            "partition_columns",
                            serde_json::to_string(&partition_columns).unwrap(),
                        ),
                        ("optimize_interval_secs", optimize_interval_secs.to_string()),
                        (
                            "optimize_target_file_size",
                            optimize_target_file_size.to_string(),
                        ),
                        ("vacuum_interval_secs", vacuum_interval_secs.to_string()),
                        (
                            "vacuum_retention_period_secs",
                            serde_json::to_string(&vacuum_retention_period_secs).unwrap(),
                        ),
                    ];
                    let _: Result<(), _> = conn.hset_multiple(&config_key, &config_values).await;
                    let _: Result<(), _> = conn.sadd("history:managed_tables", &table_name).await;

                    match manager.entry(table_name.clone()) {
                        dashmap::mapref::entry::Entry::Occupied(entry) => {
                            info!("table '{}' already registered, sending ack", table_name);
                            let table_arc = entry.get().table.clone();
                            let table_uri = table_arc.lock().await.table_uri();
                            let redis_key = format!("tangram:history:table_uri:{}", table_name);
                            let _: Result<(), _> = conn.set(&redis_key, &table_uri).await;
                            ControlResponse::TableRegistered {
                                request_id: sender_id,
                                table_name,
                                table_uri,
                            }
                        }
                        dashmap::mapref::entry::Entry::Vacant(entry) => {
                            let table_path = PathBuf::from(&base_path).join(&table_name);
                            tokio::fs::create_dir_all(&table_path).await?;
                            let table_uri = table_path.to_str().unwrap();
                            let table_url = url::Url::from_directory_path(&table_path)
                                .map_err(|_| {
                                    DeltaTableError::InvalidTableLocation(table_uri.to_string())
                                })
                                .unwrap();

                            let table_result = match DeltaTableBuilder::from_uri(table_url)?
                                .load()
                                .await
                            {
                                Ok(table) => Ok(table),
                                Err(DeltaTableError::NotATable(_)) => {
                                    info!("table '{}' not found, creating.", table_name);
                                    let columns: Vec<StructField> = arrow_schema
                                        .fields()
                                        .iter()
                                        .map(|f| f.as_ref().try_into_kernel().unwrap())
                                        .collect();
                                    CreateBuilder::new()
                                        .with_location(table_uri)
                                        .with_columns(columns)
                                        .with_partition_columns(partition_columns.iter().cloned())
                                        .await
                                }
                                Err(err) => Err(err),
                            };

                            match table_result {
                                Ok(table) => {
                                    let table_arc = Arc::new(Mutex::new(table));
                                    let managed_table = ManagedTable {
                                        table: table_arc.clone(),
                                        maintenance_config,
                                        last_optimize: Arc::new(Mutex::new(Instant::now())),
                                        last_vacuum: Arc::new(Mutex::new(Instant::now())),
                                        maintenance_lock: Arc::new(RwLock::new(())),
                                    };
                                    let maintenance_lock = managed_table.maintenance_lock.clone();
                                    entry.insert(managed_table);

                                    info!("spawning new consumer task for table '{}'", table_name);
                                    tokio::spawn(consume_stream_for_table(
                                        redis_url.clone(),
                                        table_name.clone(),
                                        table_arc.clone(),
                                        maintenance_lock,
                                        redis_read_count,
                                        redis_read_block_ms,
                                    ));

                                    let table_uri = table_arc.lock().await.table_uri();
                                    let redis_key =
                                        format!("tangram:history:table_uri:{}", table_name);
                                    let _: Result<(), _> = conn.set(&redis_key, &table_uri).await;
                                    ControlResponse::TableRegistered {
                                        request_id: sender_id,
                                        table_name,
                                        table_uri,
                                    }
                                }
                                Err(e) => {
                                    error!("failed to register table '{}': {}", table_name, e);
                                    ControlResponse::RegistrationFailed {
                                        request_id: sender_id,
                                        table_name,
                                        error: e.to_string(),
                                    }
                                }
                            }
                        }
                    }
                } else {
                    error!("failed to decode schema for table '{}'", table_name);
                    ControlResponse::RegistrationFailed {
                        request_id: sender_id,
                        table_name,
                        error: "failed to decode schema".to_string(),
                    }
                };
                let _: Result<(), _> = redis::cmd("PUBLISH")
                    .arg(&response_channel)
                    .arg(serde_json::to_string(&response)?)
                    .query_async(&mut conn)
                    .await;
            }
            Err(e) => error!("failed to parse control message '{payload}': {e}"),
        }
    }
    Ok(())
}

/// A long-running, "dumb writer" task, one per table.
///
/// Tts sole responsibility is to read from a redis stream and write to a delta
/// table.
///
/// - redis acts as the buffer. if this task is slow, messages queue up in the
///   redis stream's pending entries list, making the system more robust and
///   stateless.
/// - `xreadgroup` ensures each message is processed once.
/// - `xack` is called on both success and failure, a "best-effort" strategy
///   that accepts data loss to prevent a poison pill message from halting the
///   entire pipeline.
async fn consume_stream_for_table(
    redis_url: String,
    table_name: String,
    table: Arc<Mutex<DeltaTable>>,
    maintenance_lock: Arc<RwLock<()>>,
    redis_read_count: usize,
    redis_read_block_ms: usize,
) -> Result<()> {
    let stream_key = format!("history:ingest:{}", table_name);
    let group_name = "history_group";
    let consumer_name = format!("consumer-{}", Uuid::new_v4());

    let client = redis::Client::open(redis_url)?;
    let mut conn = client.get_multiplexed_async_connection().await?;

    let _: Result<(), _> = conn
        .xgroup_create_mkstream(&stream_key, group_name, "0-0")
        .await;

    let _: Result<(), _> = conn
        .xgroup_createconsumer(&stream_key, group_name, &consumer_name)
        .await;

    info!(
        "consumer for table '{}' on stream '{}' started",
        table_name, stream_key
    );

    loop {
        let opts = redis::streams::StreamReadOptions::default()
            .group(group_name, &consumer_name)
            .count(redis_read_count)
            .block(redis_read_block_ms);

        let result: Option<redis::streams::StreamReadReply> =
            conn.xread_options(&[&stream_key], &[">"], &opts).await?;

        if let Some(reply) = result {
            let mut batches = Vec::new();
            let mut msg_ids_to_ack = Vec::new();
            let mut total_rows = 0;

            for stream_key_result in reply.keys {
                for stream_id in stream_key_result.ids {
                    msg_ids_to_ack.push(stream_id.id.clone());
                    if let Some(payload_value) = stream_id.map.get("data") {
                        let payload: Vec<u8> = match redis::from_redis_value(payload_value) {
                            Ok(p) => p,
                            Err(e) => {
                                error!("failed to deserialize payload: {}", e);
                                continue;
                            }
                        };
                        let mut cursor = Cursor::new(payload);
                        match StreamReader::try_new(&mut cursor, None) {
                            Ok(mut reader) => {
                                if let Some(Ok(batch)) = reader.next() {
                                    total_rows += batch.num_rows();
                                    batches.push(batch);
                                }
                            }
                            Err(e) => {
                                error!(
                                    "failed to create IPC reader for table '{}': {}",
                                    table_name, e
                                );
                            }
                        }
                    }
                }
            }

            let write_successful = if !batches.is_empty() {
                info!(
                    "decoded {} rows in {} batches for table '{}'",
                    total_rows,
                    batches.len(),
                    table_name
                );
                let _guard = maintenance_lock.read().await;
                let local_table = table.lock().await.clone();
                match DeltaOps(local_table).write(batches).await {
                    Ok(new_table) => {
                        let mut table_lock = table.lock().await;
                        *table_lock = new_table;
                        true
                    }
                    Err(e) => {
                        error!(
                            "failed to write to table '{}', messages will be re-processed: {}",
                            table_name, e
                        );
                        false
                    }
                }
            } else {
                true
            };

            if write_successful && !msg_ids_to_ack.is_empty() {
                let ids_to_ack: Vec<&str> = msg_ids_to_ack.iter().map(AsRef::as_ref).collect();
                if let Err(e) = conn
                    .xack::<_, _, _, ()>(&stream_key, group_name, &ids_to_ack)
                    .await
                {
                    error!("failed to ack messages for table '{}': {}", table_name, e);
                }
            }
        }
    }
}
async fn maintenance_task(manager: Arc<ManagedTables>) {
    let mut interval = time::interval(Duration::from_secs(5));
    loop {
        interval.tick().await;

        for item in manager.iter() {
            let table_name = item.key();
            let managed_table = item.value();

            let needs_optimize = {
                managed_table.last_optimize.lock().await.elapsed()
                    >= managed_table.maintenance_config.optimize_interval
            };

            if needs_optimize {
                info!("running optimize for table {}", table_name);
                let _guard = managed_table.maintenance_lock.write().await;
                let table_clone = managed_table.table.lock().await.clone();
                match DeltaOps(table_clone)
                    .optimize()
                    .with_target_size(managed_table.maintenance_config.optimize_target_file_size)
                    .await
                {
                    Ok((new_table, _)) => {
                        let mut table_lock = managed_table.table.lock().await;
                        *table_lock = new_table;
                        *managed_table.last_optimize.lock().await = Instant::now();
                        info!("optimize successful for table {}", table_name);
                    }
                    Err(e) => error!("optimize failed for table {}: {}", table_name, e),
                }
            }

            let needs_vacuum = {
                managed_table.last_vacuum.lock().await.elapsed()
                    >= managed_table.maintenance_config.vacuum_interval
            };

            if needs_vacuum {
                info!("running vacuum for table {}", table_name);
                let table_clone = managed_table.table.lock().await.clone();
                let _guard = managed_table.maintenance_lock.write().await;
                // by default the minimum data retention is 7 days to prevent accidental data loss
                // but since we're writing frequently we want more aggressive purging of small files
                let mut builder = DeltaOps(table_clone)
                    .vacuum()
                    .with_enforce_retention_duration(false);
                if let Some(secs) = managed_table
                    .maintenance_config
                    .vacuum_retention_period_secs
                {
                    builder = builder.with_retention_period(chrono::Duration::seconds(secs as i64));
                }
                match builder.await {
                    Ok((new_table, _)) => {
                        let mut table_lock = managed_table.table.lock().await;
                        *table_lock = new_table;
                        *managed_table.last_vacuum.lock().await = Instant::now();
                        info!("vacuum successful for table {}", table_name);
                    }
                    Err(e) => error!("vacuum failed for table {}: {}", table_name, e),
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct IngestConfig {
    pub redis_url: String,
    pub control_channel: String,
    pub base_path: String,
    pub redis_read_count: usize,
    pub redis_read_block_ms: usize,
}

pub async fn start_ingest_service(config: IngestConfig) -> Result<()> {
    let manager: Arc<ManagedTables> = Arc::new(DashMap::new());

    let client = redis::Client::open(config.redis_url.clone())?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let table_names: Vec<String> = conn.smembers("history:managed_tables").await?;

    for table_name in table_names {
        let config_key = format!("history:config:{}", table_name);
        let redis_config: HashMap<String, String> = conn.hgetall(&config_key).await?;

        let schema_b64 = redis_config
            .get("schema")
            .ok_or_else(|| anyhow!("missing schema"))?;
        let arrow_schema = decode_schema(schema_b64)?;
        let partition_columns: Vec<String> = serde_json::from_str(
            redis_config
                .get("partition_columns")
                .ok_or_else(|| anyhow!("missing partition_columns"))?,
        )?;

        let maintenance_config = MaintenanceConfig {
            optimize_interval: Duration::from_secs(
                redis_config
                    .get("optimize_interval_secs")
                    .ok_or_else(|| anyhow!("missing optimize_interval_secs"))?
                    .parse()?,
            ),
            optimize_target_file_size: redis_config
                .get("optimize_target_file_size")
                .ok_or_else(|| anyhow!("missing optimize_target_file_size"))?
                .parse()?,
            vacuum_interval: Duration::from_secs(
                redis_config
                    .get("vacuum_interval_secs")
                    .ok_or_else(|| anyhow!("missing vacuum_interval_secs"))?
                    .parse()?,
            ),
            vacuum_retention_period_secs: serde_json::from_str(
                redis_config
                    .get("vacuum_retention_period_secs")
                    .ok_or_else(|| anyhow!("missing vacuum_retention_period_secs"))?,
            )?,
        };

        let table_path = PathBuf::from(&config.base_path).join(&table_name);
        tokio::fs::create_dir_all(&table_path).await?;
        let table_uri = table_path.to_str().unwrap();
        let table_url = url::Url::from_directory_path(&table_path)
            .map_err(|_| DeltaTableError::InvalidTableLocation(table_uri.to_string()))
            .unwrap();

        let table = match DeltaTableBuilder::from_uri(table_url)?.load().await {
            Ok(table) => table,
            Err(DeltaTableError::NotATable(_)) => {
                let columns: Vec<StructField> = arrow_schema
                    .fields()
                    .iter()
                    .map(|f| f.as_ref().try_into_kernel().unwrap())
                    .collect();
                CreateBuilder::new()
                    .with_location(table_uri)
                    .with_columns(columns)
                    .with_partition_columns(partition_columns)
                    .await?
            }
            Err(err) => return Err(err.into()),
        };

        let table_arc = Arc::new(Mutex::new(table));
        let managed_table = ManagedTable {
            table: table_arc.clone(),
            maintenance_config,
            last_optimize: Arc::new(Mutex::new(Instant::now())),
            last_vacuum: Arc::new(Mutex::new(Instant::now())),
            maintenance_lock: Arc::new(RwLock::new(())),
        };
        let maintenance_lock = managed_table.maintenance_lock.clone();
        manager.insert(table_name.clone(), managed_table);

        tokio::spawn(consume_stream_for_table(
            config.redis_url.clone(),
            table_name,
            table_arc,
            maintenance_lock,
            config.redis_read_count,
            config.redis_read_block_ms,
        ));
    }

    let mut control_handle = tokio::spawn(control_subscriber(
        config.redis_url.clone(),
        config.control_channel.clone(),
        manager.clone(),
        config.base_path.clone(),
        config.redis_read_count,
        config.redis_read_block_ms,
    ));

    let mut maintenance_handle = tokio::spawn(maintenance_task(manager));

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("shutdown signal received, terminating history service");
            control_handle.abort();
            maintenance_handle.abort();
        },
        res = &mut control_handle => {
             error!("control subscriber task exited unexpectedly: {:?}", res);
        },
        res = &mut maintenance_handle => {
             error!("maintenance task exited unexpectedly: {:?}", res);
        }
    }

    Ok(())
}

use crate::protocol::{ControlMessage, ControlResponse, RegisterTable, TableInfo};
use anyhow::{anyhow, Context, Result};
use arrow_json::writer::ArrayWriter;
use base64::{engine::general_purpose, Engine as _};
use dashmap::DashMap;
use deltalake::arrow::datatypes::Schema as ArrowSchema;
use deltalake::arrow::ipc::reader::{FileReader, StreamReader};
use deltalake::datafusion::prelude::{SQLOptions, SessionContext};
use deltalake::kernel::engine::arrow_conversion::TryIntoKernel;
use deltalake::kernel::StructField;
use deltalake::operations::create::CreateBuilder;
use deltalake::{checkpoints, DeltaTable, DeltaTableBuilder, DeltaTableError};
use futures::StreamExt;
use redis::AsyncCommands;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tangram_core::shutdown::{abort_and_await, Shutdown};
use tokio::sync::{watch, Mutex, RwLock, Semaphore};
use tokio::time::{self, Instant};
use tracing::{error, info, warn};
use uuid::Uuid;

fn decode_schema(base64_schema: &str) -> Result<Arc<ArrowSchema>> {
    let schema_bytes = general_purpose::STANDARD.decode(base64_schema)?;
    let cursor = Cursor::new(schema_bytes);
    let schema_reader = FileReader::try_new(cursor, None)?;
    Ok(schema_reader.schema())
}

fn record_batches_to_json_rows(
    batches: &[&deltalake::arrow::record_batch::RecordBatch],
) -> Result<Vec<Map<String, Value>>> {
    let buf = Vec::new();
    let mut writer = ArrayWriter::new(buf);
    writer.write_batches(batches)?;
    writer.finish()?;
    let json_data = writer.into_inner();
    let json_rows: Vec<Map<String, Value>> = serde_json::from_slice(&json_data)?;
    Ok(json_rows)
}

#[derive(Debug, Clone)]
pub struct MaintenanceConfig {
    pub optimize_interval: Duration,
    pub optimize_target_file_size: u64,
    pub vacuum_interval: Duration,
    pub vacuum_retention_period_secs: Option<u64>,
}

#[derive(Clone)]
struct ManagedTable {
    table_url: String,
    maintenance_config: MaintenanceConfig,
    last_optimize: Arc<Mutex<Instant>>,
    last_vacuum: Arc<Mutex<Instant>>,
    // ensure we don't spawn overlapping maintenance tasks for the same table
    optimize_lock: Arc<Semaphore>,
    vacuum_lock: Arc<Semaphore>,
    ingest_lock: Arc<RwLock<()>>,
}

/// Central state of the history service.
type ManagedTables = DashMap<String, ManagedTable>;

async fn handle_list_tables(
    sender_id: String,
    channel: String,
    manager: Arc<ManagedTables>,
    mut conn: redis::aio::MultiplexedConnection,
) -> Result<()> {
    let response_channel = format!("{}:response:{}", channel, sender_id);
    let mut tables = Vec::new();

    for entry in manager.iter() {
        let name = entry.key().clone();
        let managed = entry.value();

        let Ok(table_url) = url::Url::parse(&managed.table_url) else {
            continue;
        };
        let Ok(builder) = DeltaTableBuilder::from_url(table_url) else {
            continue;
        };
        let Ok(table) = builder.load().await else {
            continue;
        };
        let Ok(snapshot) = table.snapshot() else {
            continue;
        };

        let schema_json = serde_json::to_value(snapshot.schema())
            .unwrap_or(Value::String("schema_error".to_string()));
        tables.push(TableInfo {
            name,
            uri: managed.table_url.clone(),
            version: table.version().unwrap_or(-1),
            schema: schema_json.to_string(),
        });
    }

    let response = ControlResponse::TableList {
        request_id: sender_id,
        tables,
    };
    let _: Result<(), _> = redis::cmd("PUBLISH")
        .arg(&response_channel)
        .arg(serde_json::to_string(&response)?)
        .query_async(&mut conn)
        .await;
    Ok(())
}

async fn handle_delete_rows(
    sender_id: String,
    table_name: String,
    predicate: String,
    dry_run: bool,
    channel: String,
    manager: Arc<ManagedTables>,
    mut conn: redis::aio::MultiplexedConnection,
) -> Result<()> {
    let response_channel = format!("{}:response:{}", channel, sender_id);

    let managed = if let Some(managed) = manager.get(&table_name) {
        managed
    } else {
        let response = ControlResponse::CommandFailed {
            request_id: sender_id.clone(),
            error: format!("table {} not found", table_name),
        };
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg(&response_channel)
            .arg(serde_json::to_string(&response)?)
            .query_async(&mut conn)
            .await;
        return Ok(());
    };

    let _ingest_permit = managed.ingest_lock.write().await;
    info!("locks acquired for deletion in table {}", table_name);

    let response = (async {
        let url = url::Url::parse(&managed.table_url).map_err(|_| "invalid table URL")?;
        let table = DeltaTableBuilder::from_url(url)
            .map_err(|e| e.to_string())?
            .load()
            .await
            .map_err(|e| e.to_string())?;

        if dry_run {
            Ok(perform_dry_run_delete(sender_id.clone(), table, predicate).await)
        } else {
            Ok(perform_actual_delete(sender_id.clone(), table, predicate).await)
        }
    })
    .await
    .unwrap_or_else(|e| ControlResponse::CommandFailed {
        request_id: sender_id.clone(),
        error: e,
    });

    let _: Result<(), _> = redis::cmd("PUBLISH")
        .arg(&response_channel)
        .arg(serde_json::to_string(&response)?)
        .query_async(&mut conn)
        .await;
    Ok(())
}

pub(crate) async fn perform_dry_run_delete(
    request_id: String,
    table: DeltaTable,
    predicate: String,
) -> ControlResponse {
    let result = (async {
        let ctx = SessionContext::new();
        ctx.register_table("t", Arc::new(table))?;

        let options = SQLOptions::new()
            .with_allow_ddl(false)
            .with_allow_dml(false)
            .with_allow_statements(false);
        let sql = format!("SELECT * FROM t WHERE {}", predicate);
        let df = ctx.sql_with_options(&sql, options).await?;
        let limited_df = df.limit(0, Some(10))?;
        let preview_batches = limited_df.collect().await?;

        let count_sql = format!("SELECT count(*) FROM t WHERE {}", predicate);
        let count_df = ctx.sql_with_options(&count_sql, options).await?;
        let count_batches = count_df.collect().await?;
        let count = count_batches[0]
            .column(0)
            .as_any()
            .downcast_ref::<deltalake::arrow::array::Int64Array>()
            .ok_or(anyhow!("failed to cast count result"))?
            .value(0) as usize;

        let refs: Vec<&deltalake::arrow::array::RecordBatch> = preview_batches.iter().collect();
        let json_rows = record_batches_to_json_rows(&refs)?;

        Ok::<_, anyhow::Error>((count, json_rows))
    })
    .await;

    match result {
        Ok((count, json_rows)) => ControlResponse::DeleteOutput {
            request_id,
            dry_run: true,
            affected_rows: count,
            preview: Some(serde_json::to_string(&json_rows).unwrap()),
        },
        Err(e) => ControlResponse::CommandFailed {
            request_id,
            error: e.to_string(),
        },
    }
}

pub(crate) async fn perform_actual_delete(
    request_id: String,
    table: DeltaTable,
    predicate: String,
) -> ControlResponse {
    match table.delete().with_predicate(predicate).await {
        Ok((_, metrics)) => ControlResponse::DeleteOutput {
            request_id,
            dry_run: false,
            affected_rows: metrics.num_deleted_rows,
            preview: None,
        },
        Err(e) => ControlResponse::CommandFailed {
            request_id,
            error: e.to_string(),
        },
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_register_table(
    reg: RegisterTable,
    channel: String,
    manager: Arc<ManagedTables>,
    mut conn: redis::aio::MultiplexedConnection,
    base_path: String,
    shutdown: watch::Receiver<bool>,
    redis_url: String,
    redis_read_count: usize,
    redis_read_block_ms: usize,
) -> Result<()> {
    let response_channel = format!("{}:response:{}", channel, reg.sender_id);

    let arrow_schema = match decode_schema(&reg.schema) {
        Ok(schema) => schema,
        Err(e) => {
            error!(
                "failed to decode schema for table '{}': {}",
                reg.table_name, e
            );
            let response = ControlResponse::RegistrationFailed {
                request_id: reg.sender_id.clone(),
                table_name: reg.table_name,
                error: "failed to decode schema".to_string(),
            };
            let _: Result<(), _> = redis::cmd("PUBLISH")
                .arg(&response_channel)
                .arg(serde_json::to_string(&response)?)
                .query_async(&mut conn)
                .await;
            return Ok(());
        }
    };

    let maintenance_config = MaintenanceConfig {
        optimize_interval: Duration::from_secs(reg.optimize_interval_secs),
        optimize_target_file_size: reg.optimize_target_file_size,
        vacuum_interval: Duration::from_secs(reg.vacuum_interval_secs),
        vacuum_retention_period_secs: reg.vacuum_retention_period_secs,
    };

    let config_key = format!("history:config:{}", reg.table_name);
    let config_values: Vec<(&str, String)> = vec![
        ("schema", reg.schema),
        (
            "partition_columns",
            serde_json::to_string(&reg.partition_columns)?,
        ),
        (
            "optimize_interval_secs",
            reg.optimize_interval_secs.to_string(),
        ),
        (
            "optimize_target_file_size",
            reg.optimize_target_file_size.to_string(),
        ),
        ("vacuum_interval_secs", reg.vacuum_interval_secs.to_string()),
        (
            "vacuum_retention_period_secs",
            serde_json::to_string(&reg.vacuum_retention_period_secs)?,
        ),
        ("checkpoint_interval", reg.checkpoint_interval.to_string()),
    ];
    let _: Result<(), _> = conn.hset_multiple(&config_key, &config_values).await;
    let _: Result<(), _> = conn.sadd("history:managed_tables", &reg.table_name).await;

    let response = match manager.entry(reg.table_name.clone()) {
        dashmap::mapref::entry::Entry::Occupied(entry) => {
            info!("table '{}' already registered, sending ack", reg.table_name);
            let table_url = entry.get().table_url.clone();
            let redis_key = format!("tangram:history:table_uri:{}", reg.table_name);
            let _: Result<(), _> = conn.set(&redis_key, &table_url).await;
            ControlResponse::TableRegistered {
                request_id: reg.sender_id.clone(),
                table_name: reg.table_name.clone(),
                table_uri: table_url,
            }
        }
        dashmap::mapref::entry::Entry::Vacant(entry) => {
            let table_path = PathBuf::from(&base_path).join(&reg.table_name);
            tokio::fs::create_dir_all(&table_path).await?;
            let table_url_obj = url::Url::from_directory_path(&table_path)
                .map_err(|_| anyhow!("Failed to convert table path to URL: {:?}", table_path))?;
            let table_url_str = table_url_obj.to_string();

            let table_result = match DeltaTableBuilder::from_url(table_url_obj.clone())?
                .load()
                .await
            {
                Ok(table) => Ok(table),
                Err(DeltaTableError::NotATable(_)) => {
                    info!("table '{}' not found, creating.", reg.table_name);
                    let columns: Vec<StructField> = arrow_schema
                        .fields()
                        .iter()
                        .map(|f| f.as_ref().try_into_kernel())
                        .collect::<Result<Vec<_>, _>>()?;
                    CreateBuilder::new()
                        .with_location(table_url_str.clone())
                        .with_columns(columns)
                        .with_partition_columns(reg.partition_columns.iter().cloned())
                        .await
                }
                Err(err) => Err(err),
            };

            match table_result {
                Ok(table) => {
                    let ingest_lock = Arc::new(RwLock::new(()));
                    entry.insert(ManagedTable {
                        table_url: table_url_str.clone(),
                        maintenance_config,
                        last_optimize: Arc::new(Mutex::new(Instant::now())),
                        last_vacuum: Arc::new(Mutex::new(Instant::now())),
                        optimize_lock: Arc::new(Semaphore::new(1)),
                        vacuum_lock: Arc::new(Semaphore::new(1)),
                        ingest_lock: ingest_lock.clone(),
                    });

                    info!("spawning new consumer task for table '{}'", reg.table_name);
                    tokio::spawn(consume_stream_for_table(
                        redis_url,
                        reg.table_name.clone(),
                        table,
                        reg.checkpoint_interval,
                        redis_read_count,
                        redis_read_block_ms,
                        shutdown,
                        ingest_lock,
                    ));

                    let redis_key = format!("tangram:history:table_uri:{}", reg.table_name);
                    let _: Result<(), _> = conn.set(&redis_key, &table_url_str).await;
                    ControlResponse::TableRegistered {
                        request_id: reg.sender_id.clone(),
                        table_name: reg.table_name.clone(),
                        table_uri: table_url_str,
                    }
                }
                Err(e) => {
                    error!("failed to register table '{}': {}", reg.table_name, e);
                    ControlResponse::RegistrationFailed {
                        request_id: reg.sender_id.clone(),
                        table_name: reg.table_name.clone(),
                        error: e.to_string(),
                    }
                }
            }
        }
    };

    let _: Result<(), _> = redis::cmd("PUBLISH")
        .arg(&response_channel)
        .arg(serde_json::to_string(&response)?)
        .query_async(&mut conn)
        .await;
    Ok(())
}

async fn control_subscriber(
    redis_url: String,
    channel: String,
    manager: Arc<ManagedTables>,
    base_path: String,
    redis_read_count: usize,
    redis_read_block_ms: usize,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    let client = redis::Client::open(redis_url.clone()).context("failed to create redis client")?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;
    info!("control subscriber listening on '{}'", channel);

    let mut stream = pubsub.on_message();
    loop {
        if *shutdown.borrow() {
            break;
        }

        let msg = tokio::select! {
            msg = stream.next() => msg,
            _ = shutdown.changed() => break,
        };

        let Some(msg) = msg else {
            break;
        };

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
            Ok(ControlMessage::ListTables { sender_id }) => {
                if let Err(e) =
                    handle_list_tables(sender_id, channel.clone(), manager.clone(), conn.clone())
                        .await
                {
                    error!("ListTables error: {}", e);
                }
            }
            Ok(ControlMessage::DeleteRows {
                sender_id,
                table_name,
                predicate,
                dry_run,
            }) => {
                if let Err(e) = handle_delete_rows(
                    sender_id,
                    table_name,
                    predicate,
                    dry_run,
                    channel.clone(),
                    manager.clone(),
                    conn.clone(),
                )
                .await
                {
                    error!("DeleteRows error: {}", e);
                }
            }
            Ok(ControlMessage::RegisterTable(reg)) => {
                if let Err(e) = handle_register_table(
                    reg,
                    channel.clone(),
                    manager.clone(),
                    conn.clone(),
                    base_path.clone(),
                    shutdown.clone(),
                    redis_url.clone(),
                    redis_read_count,
                    redis_read_block_ms,
                )
                .await
                {
                    error!("RegisterTable error: {}", e);
                }
            }
            Err(e) => error!("failed to parse control message '{payload}': {e}"),
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn consume_stream_for_table(
    redis_url: String,
    table_name: String,
    mut table: DeltaTable,
    checkpoint_interval: u64,
    redis_read_count: usize,
    redis_read_block_ms: usize,
    mut shutdown: watch::Receiver<bool>,
    ingest_lock: Arc<RwLock<()>>,
) -> Result<()> {
    let stream_key = format!("history:ingest:{}", table_name);
    let group_name = "history_group";
    let consumer_name = format!("consumer-{}", Uuid::new_v4());

    let client = redis::Client::open(redis_url)?;
    // NOTE: redis 0.32..1.0 introduced a default response timeout of 500ms, we disable it because XREAD blocks for 5s
    let redis_config = redis::AsyncConnectionConfig::new().set_response_timeout(None);
    let mut conn = client
        .get_multiplexed_async_connection_with_config(&redis_config)
        .await?;
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
        if *shutdown.borrow() {
            break;
        }

        let opts = redis::streams::StreamReadOptions::default()
            .group(group_name, &consumer_name)
            .count(redis_read_count)
            .block(redis_read_block_ms);

        let stream_keys = [&stream_key];
        let ids = [">"];
        let result: Option<redis::streams::StreamReadReply> = tokio::select! {
            result = conn.xread_options(&stream_keys, &ids, &opts) => result?,
            _ = shutdown.changed() => break,
        };

        let Some(reply) = result else {
            continue;
        };

        let mut batches = Vec::new();
        let mut msg_ids_to_ack = Vec::new();
        let mut total_rows = 0;

        for stream_key_result in reply.keys {
            for stream_id in stream_key_result.ids {
                msg_ids_to_ack.push(stream_id.id.clone());
                let Some(payload_value) = stream_id.map.get("data") else {
                    continue;
                };

                let payload: Vec<u8> = match redis::from_redis_value_ref(payload_value) {
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
                    Err(e) => error!(
                        "failed to create IPC reader for table '{}': {}",
                        table_name, e
                    ),
                }
            }
        }

        if !batches.is_empty() {
            info!(
                "decoded {} rows in {} batches for table '{}'",
                total_rows,
                batches.len(),
                table_name
            );
            let _lock = ingest_lock.read().await;

            if let Err(e) = table.update_state().await {
                error!(
                    "failed to update table state for '{}' before write: {}",
                    table_name, e
                );
            }

            match table.clone().write(batches).await {
                Ok(new_table) => {
                    table = new_table;
                    if let Some(version) = table.version() {
                        if version >= 0 && (version as u64).is_multiple_of(checkpoint_interval) {
                            if let Err(e) = checkpoints::create_checkpoint(&table, None).await {
                                error!(
                                    "failed to create checkpoint for table '{}' at version {}: {}",
                                    table_name, version, e
                                );
                            } else {
                                info!(
                                    "created checkpoint for table '{}' at version {}",
                                    table_name, version
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    // swallow the error and proceed to ack, accepting data loss
                    // delta-rs handles commit retries internally, so if we get here it's likely fatal/storage related
                    error!(
                        "failed to write to table '{}', dropping messages: {}",
                        table_name, e
                    );
                    let _ = table.update_state().await;
                }
            }
        }

        if !msg_ids_to_ack.is_empty() {
            let ids_to_ack: Vec<&str> = msg_ids_to_ack.iter().map(AsRef::as_ref).collect();
            if let Err(e) = conn
                .xack::<_, _, _, ()>(&stream_key, group_name, &ids_to_ack)
                .await
            {
                error!("failed to ack messages for table '{}': {}", table_name, e);
            }
        }
    }
    Ok(())
}

async fn perform_maintenance(table_name: String, managed_table: ManagedTable) {
    let Ok(_optimize_permit) = managed_table.optimize_lock.try_acquire() else {
        return;
    };

    let needs_optimize = {
        managed_table.last_optimize.lock().await.elapsed()
            >= managed_table.maintenance_config.optimize_interval
    };

    let table_url = match url::Url::parse(&managed_table.table_url) {
        Ok(u) => u,
        Err(e) => {
            error!("invalid table URL for {}: {}", table_name, e);
            return;
        }
    };

    if needs_optimize {
        let _lock = managed_table.ingest_lock.write().await;
        if let Ok(builder) = DeltaTableBuilder::from_url(table_url.clone()) {
            if let Ok(maintenance_table) = builder.load().await {
                info!("running optimize for table {}", table_name);
                match maintenance_table
                    .optimize()
                    .with_target_size(managed_table.maintenance_config.optimize_target_file_size)
                    .await
                {
                    Ok(_) => {
                        *managed_table.last_optimize.lock().await = Instant::now();
                        info!("optimize successful for table {}", table_name);
                    }
                    Err(e) => error!("optimize failed for table {}: {}", table_name, e),
                }
            }
        }
    }
    drop(_optimize_permit);

    let Ok(_vacuum_permit) = managed_table.vacuum_lock.try_acquire() else {
        return;
    };

    let needs_vacuum = {
        managed_table.last_vacuum.lock().await.elapsed()
            >= managed_table.maintenance_config.vacuum_interval
    };

    if needs_vacuum {
        let _lock = managed_table.ingest_lock.write().await;
        if let Ok(builder) = DeltaTableBuilder::from_url(table_url) {
            if let Ok(maintenance_table) = builder.load().await {
                info!("running vacuum for table {}", table_name);
                let mut builder = maintenance_table
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
                        *managed_table.last_vacuum.lock().await = Instant::now();
                        info!("vacuum successful for table {}", table_name);
                        if let Err(e) = checkpoints::cleanup_metadata(&new_table, None).await {
                            warn!("failed to cleanup metadata for table {}: {}", table_name, e);
                        } else {
                            info!("cleanup metadata successful for table {}", table_name);
                        }
                    }
                    Err(e) => error!("vacuum failed for table {}: {}", table_name, e),
                }
            }
        }
    }
}

async fn maintenance_task(manager: Arc<ManagedTables>, mut shutdown: watch::Receiver<bool>) {
    let mut interval = time::interval(Duration::from_secs(5));
    loop {
        if *shutdown.borrow() {
            break;
        }
        tokio::select! {
            _ = interval.tick() => {}
            _ = shutdown.changed() => break,
        }
        let tables: Vec<(String, ManagedTable)> = manager
            .iter()
            .map(|r| (r.key().clone(), r.value().clone()))
            .collect();
        for (table_name, managed_table) in tables {
            tokio::spawn(perform_maintenance(table_name, managed_table));
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
    let (shutdown, shutdown_rx) = Shutdown::new();

    let client = redis::Client::open(config.redis_url.clone())?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let table_names: Vec<String> = conn.smembers("history:managed_tables").await?;

    let mut ingest_handles = Vec::new();

    for table_name in table_names {
        let config_key = format!("history:config:{}", table_name);
        let redis_config: HashMap<String, String> = conn.hgetall(&config_key).await?;

        if redis_config.is_empty() {
            warn!("config missing for table '{}', skipping", table_name);
            continue;
        }

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
                    .context("missing opt interval")?
                    .parse()?,
            ),
            optimize_target_file_size: redis_config
                .get("optimize_target_file_size")
                .context("missing opt file size")?
                .parse()?,
            vacuum_interval: Duration::from_secs(
                redis_config
                    .get("vacuum_interval_secs")
                    .context("missing vac interval")?
                    .parse()?,
            ),
            vacuum_retention_period_secs: serde_json::from_str(
                redis_config
                    .get("vacuum_retention_period_secs")
                    .context("missing vac retention")?,
            )?,
        };

        let checkpoint_interval: u64 = redis_config
            .get("checkpoint_interval")
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);
        let table_path = PathBuf::from(&config.base_path).join(&table_name);
        tokio::fs::create_dir_all(&table_path).await?;
        let table_url_obj = url::Url::from_directory_path(&table_path)
            .map_err(|_| anyhow!("invalid table path: {:?}", table_path))?;
        let table_url_str = table_url_obj.to_string();

        let table = match DeltaTableBuilder::from_url(table_url_obj.clone())?
            .load()
            .await
        {
            Ok(table) => table,
            Err(DeltaTableError::NotATable(_)) => {
                let columns: Vec<StructField> = arrow_schema
                    .fields()
                    .iter()
                    .map(|f| f.as_ref().try_into_kernel())
                    .collect::<Result<Vec<_>, _>>()?;
                CreateBuilder::new()
                    .with_location(table_url_str.clone())
                    .with_columns(columns)
                    .with_partition_columns(partition_columns)
                    .await?
            }
            Err(err) => return Err(err.into()),
        };

        let ingest_lock = Arc::new(RwLock::new(()));
        manager.insert(
            table_name.clone(),
            ManagedTable {
                table_url: table_url_str,
                maintenance_config,
                last_optimize: Arc::new(Mutex::new(Instant::now())),
                last_vacuum: Arc::new(Mutex::new(Instant::now())),
                optimize_lock: Arc::new(Semaphore::new(1)),
                vacuum_lock: Arc::new(Semaphore::new(1)),
                ingest_lock: ingest_lock.clone(),
            },
        );

        ingest_handles.push(tokio::spawn(consume_stream_for_table(
            config.redis_url.clone(),
            table_name,
            table,
            checkpoint_interval,
            config.redis_read_count,
            config.redis_read_block_ms,
            shutdown_rx.clone(),
            ingest_lock,
        )));
    }

    let mut control_handle = tokio::spawn(control_subscriber(
        config.redis_url.clone(),
        config.control_channel.clone(),
        manager.clone(),
        config.base_path.clone(),
        config.redis_read_count,
        config.redis_read_block_ms,
        shutdown_rx.clone(),
    ));
    let mut maintenance_handle = tokio::spawn(maintenance_task(manager, shutdown_rx.clone()));

    let shutdown_reason = tokio::select! {
        _ = tokio::signal::ctrl_c() => "ctrl_c",
        res = &mut control_handle => { error!("control subscriber task exited unexpectedly: {:?}", res); "control_exited" }
        res = &mut maintenance_handle => { error!("maintenance task exited unexpectedly: {:?}", res); "maintenance_exited" }
    };

    info!("shutdown initiated by {}", shutdown_reason);
    shutdown.trigger();
    for mut handle in ingest_handles {
        let _ = abort_and_await(&mut handle).await;
    }
    let _ = abort_and_await(&mut control_handle).await;
    let _ = abort_and_await(&mut maintenance_handle).await;
    Ok(())
}

use crate::protocol::{ControlMessage, ControlResponse, RegisterTable, TableInfo};
use crate::staging::{recover_pending, Acknowledger};
use anyhow::{anyhow, Context, Result};
use arrow_json::writer::ArrayWriter;
use base64::{engine::general_purpose, Engine as _};
use dashmap::DashMap;
use deltalake::arrow::datatypes::Schema as ArrowSchema;
use deltalake::arrow::ipc::reader::{FileReader, StreamReader};
use deltalake::datafusion::prelude::SessionContext;
use deltalake::delta_datafusion::DataFusionMixins;
use deltalake::kernel::engine::arrow_conversion::TryIntoKernel;
use deltalake::kernel::StructField;
use deltalake::operations::create::CreateBuilder;
use deltalake::{checkpoints, DeltaTable, DeltaTableBuilder, DeltaTableError};
use futures::StreamExt;
use redis::AsyncCommands;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::Cursor;
use std::num::NonZeroU64;
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
            version: table.version().map(|v| v as i64).unwrap_or(-1),
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

        let response = if dry_run {
            perform_dry_run_delete(sender_id.clone(), table, predicate).await
        } else {
            perform_actual_delete(sender_id.clone(), table, predicate).await
        };

        Ok(response)
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
        let predicate = table
            .snapshot()?
            .snapshot()
            .parse_predicate_expression(&predicate, &ctx.state())?;
        let dataframe = ctx
            .read_table(table.table_provider().await?)?
            .filter(predicate)?;

        let count = dataframe.clone().count().await?;
        let preview_batches = dataframe.limit(0, Some(10))?.collect().await?;

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
            affected_rows: metrics.num_deleted_rows.unwrap_or(0),
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

async fn history_connection(
    client: &redis::Client,
    config: &redis::AsyncConnectionConfig,
    stream: &str,
    group: &str,
    consumer: &str,
    shutdown: &mut watch::Receiver<bool>,
) -> Option<redis::aio::MultiplexedConnection> {
    let mut delay = Duration::from_secs(1);
    loop {
        if *shutdown.borrow() {
            return None;
        }
        let connect = async {
            let mut conn = client
                .get_multiplexed_async_connection_with_config(config)
                .await?;
            let created: redis::RedisResult<()> = redis::cmd("XGROUP")
                .arg("CREATE")
                .arg(stream)
                .arg(group)
                .arg("0-0")
                .arg("MKSTREAM")
                .query_async(&mut conn)
                .await;
            if let Err(error) = created {
                if !error.to_string().contains("BUSYGROUP") {
                    return Err(error);
                }
            }
            let _: usize = redis::cmd("XGROUP")
                .arg("CREATECONSUMER")
                .arg(stream)
                .arg(group)
                .arg(consumer)
                .query_async(&mut conn)
                .await?;
            Ok::<_, redis::RedisError>(conn)
        };
        let outcome = tokio::select! {
            result = time::timeout(Duration::from_secs(10), connect) => result,
            _ = shutdown.changed() => return None,
        };
        match outcome {
            Ok(Ok(conn)) => return Some(conn),
            error => warn!(
                ?error,
                ?delay,
                "History Redis connection unavailable; pending batches retained"
            ),
        }
        tokio::select! {
            _ = time::sleep(delay) => {},
            _ = shutdown.changed() => return None,
        }
        delay = (delay * 2).min(Duration::from_secs(30));
    }
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
    let Some(mut conn) = history_connection(
        &client,
        &redis_config,
        &stream_key,
        group_name,
        &consumer_name,
        &mut shutdown,
    )
    .await
    else {
        return Ok(());
    };
    let mut acknowledger = Acknowledger::default();
    let mut claim_cursor = "0-0".to_string();

    info!(
        "consumer for table '{}' on stream '{}' started",
        table_name, stream_key
    );

    loop {
        if *shutdown.borrow() {
            break;
        }

        let read = async {
            let recovered = recover_pending(
                &mut conn,
                &stream_key,
                group_name,
                &consumer_name,
                &claim_cursor,
                redis_read_count,
            )
            .await?;
            claim_cursor = recovered.next_stream_id;
            if !recovered.claimed.is_empty() {
                warn!(
                    table = table_name,
                    entries = recovered.claimed.len(),
                    "Recovering idle pending history; uncertain prior commits may repeat rows"
                );
                return Ok(recovered.claimed);
            }
            let opts = redis::streams::StreamReadOptions::default()
                .group(group_name, &consumer_name)
                .count(redis_read_count)
                .block(redis_read_block_ms);
            let reply: Option<redis::streams::StreamReadReply> =
                conn.xread_options(&[&stream_key], &[">"], &opts).await?;
            Ok::<_, redis::RedisError>(
                reply
                    .into_iter()
                    .flat_map(|r| r.keys)
                    .flat_map(|k| k.ids)
                    .collect(),
            )
        };
        let stream_ids = match tokio::select! {
            result = read => result,
            _ = shutdown.changed() => break,
        } {
            Ok(ids) => ids,
            Err(error) => {
                warn!(table = table_name, %error, "History read failed; reconnecting without acknowledging data");
                tokio::select! { _ = time::sleep(Duration::from_secs(1)) => {}, _ = shutdown.changed() => break, }
                let Some(new_conn) = history_connection(
                    &client,
                    &redis_config,
                    &stream_key,
                    group_name,
                    &consumer_name,
                    &mut shutdown,
                )
                .await
                else {
                    break;
                };
                conn = new_conn;
                continue;
            }
        };

        let mut batches = Vec::new();
        let mut msg_ids_to_ack = Vec::new();
        let mut total_rows = 0;

        for stream_id in stream_ids {
            let decoded = (|| {
                let value = stream_id
                    .map
                    .get("data")
                    .ok_or_else(|| anyhow!("missing Arrow data field"))?;
                let payload: Vec<u8> = redis::from_redis_value_ref(value)?;
                let reader = StreamReader::try_new(Cursor::new(payload), None)?;
                let decoded = reader.collect::<std::result::Result<Vec<_>, _>>()?;
                if decoded.is_empty() {
                    return Err(anyhow!("empty Arrow stream"));
                }
                Ok(decoded)
            })();
            match decoded {
                Ok(decoded) => {
                    total_rows += decoded.iter().map(|b| b.num_rows()).sum::<usize>();
                    batches.extend(decoded);
                    msg_ids_to_ack.push(stream_id.id);
                }
                Err(error) => {
                    error!(table = table_name, id = stream_id.id, %error, "Invalid history batch retained pending, not acknowledged")
                }
            }
        }

        if batches.is_empty() {
            continue;
        }
        info!(
            rows = total_rows,
            batches = batches.len(),
            table = table_name,
            "Decoded history batches"
        );
        let mut retry = Duration::from_secs(1);
        loop {
            let persist = async {
                let _lock = ingest_lock.read().await;
                table.update_state().await?;
                table.clone().write(batches.clone()).await
            };
            let outcome = tokio::select! {
                result = persist => result,
                _ = shutdown.changed() => return Ok(()),
            };
            match outcome {
                Ok(committed) => {
                    table = committed;
                    break;
                }
                Err(error) => {
                    warn!(table = table_name, %error, ?retry, "History commit failed; retaining pending batch and retrying; uncertain commits may repeat rows")
                }
            }
            tokio::select! {
                _ = time::sleep(retry) => {},
                _ = shutdown.changed() => return Ok(()),
            }
            retry = (retry * 2).min(Duration::from_secs(30));
        }
        drop(batches); // Committed data lives on disk; ACK retries need only IDs.
                       // This is reached only after the durable Delta commit. Retry cleanup
                       // without rewriting a committed batch if an ACK response is uncertain.
        loop {
            let outcome = tokio::select! {
                result = time::timeout(Duration::from_secs(10), acknowledger.persisted(&mut conn, &stream_key, group_name, &msg_ids_to_ack)) => result,
                _ = shutdown.changed() => return Ok(()),
            };
            if matches!(outcome, Ok(Ok(()))) {
                break;
            }
            warn!(
                table = table_name,
                ?outcome,
                "Committed history awaiting staging cleanup; retrying without rewriting rows"
            );
            tokio::select! { _ = time::sleep(Duration::from_secs(1)) => {}, _ = shutdown.changed() => return Ok(()), }
            let Some(new_conn) = history_connection(
                &client,
                &redis_config,
                &stream_key,
                group_name,
                &consumer_name,
                &mut shutdown,
            )
            .await
            else {
                return Ok(());
            };
            conn = new_conn;
        }
        if let Some(version) = table.version() {
            if version.is_multiple_of(checkpoint_interval) {
                if let Err(error) = checkpoints::create_checkpoint(&table, None).await {
                    error!(table = table_name, %error, "History checkpoint failed after durable commit");
                }
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
        'optimize: {
            let Ok(builder) = DeltaTableBuilder::from_url(table_url.clone()) else {
                break 'optimize;
            };
            let Ok(maintenance_table) = builder.load().await else {
                break 'optimize;
            };

            if let Some(target_size) =
                NonZeroU64::new(managed_table.maintenance_config.optimize_target_file_size)
            {
                info!("running optimize for table {}", table_name);
                match maintenance_table
                    .optimize()
                    .with_target_size(target_size)
                    .await
                {
                    Ok(_) => {
                        *managed_table.last_optimize.lock().await = Instant::now();
                        info!("optimize successful for table {}", table_name);
                    }
                    Err(e) => error!("optimize failed for table {}: {}", table_name, e),
                }
            } else {
                error!(
                    "invalid optimize target file size for table {}: must be > 0",
                    table_name
                );
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
        'vacuum: {
            let Ok(builder) = DeltaTableBuilder::from_url(table_url) else {
                break 'vacuum;
            };
            let Ok(maintenance_table) = builder.load().await else {
                break 'vacuum;
            };

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

#[cfg(test)]
mod retention_tests {
    use super::*;
    use deltalake::arrow::{
        array::Int32Array,
        datatypes::{DataType, Field},
        ipc::writer::StreamWriter,
        record_batch::RecordBatch,
    };

    async fn table_fixture() -> (PathBuf, DeltaTable, Arc<ArrowSchema>) {
        let directory =
            std::env::temp_dir().join(format!("tangram-history-retention-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let schema = Arc::new(ArrowSchema::new(vec![Field::new(
            "value",
            DataType::Int32,
            false,
        )]));
        let columns: Vec<StructField> = schema
            .fields()
            .iter()
            .map(|f| f.as_ref().try_into_kernel().unwrap())
            .collect();
        let table = CreateBuilder::new()
            .with_location(
                url::Url::from_directory_path(&directory)
                    .unwrap()
                    .to_string(),
            )
            .with_columns(columns)
            .await
            .unwrap();
        (directory, table, schema)
    }
    fn payload(schema: Arc<ArrowSchema>) -> Vec<u8> {
        let batch =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(Int32Array::from(vec![42]))])
                .unwrap();
        let mut bytes = Vec::new();
        {
            let mut writer = StreamWriter::try_new(&mut bytes, &schema).unwrap();
            writer.write(&batch).unwrap();
            writer.write(&batch).unwrap();
            writer.finish().unwrap();
        }
        bytes
    }
    async fn stop(signal: watch::Sender<bool>, task: tokio::task::JoinHandle<Result<()>>) {
        signal.send(true).unwrap();
        time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }
    #[tokio::test]
    #[ignore = "requires an isolated Redis on a port other than 6379"]
    async fn committed_delta_rows_survive_staging_deletion() {
        let (mut conn, namespace) = crate::staging::tests::fixture().await;
        let name = namespace.replace(':', "_");
        let key = format!("history:ingest:{name}");
        let (directory, table, schema) = table_fixture().await;
        let _: String = conn
            .xadd(&key, "*", &[("data", payload(schema))])
            .await
            .unwrap();
        let (signal, shutdown) = watch::channel(false);
        let uri = std::env::var("TANGRAM_HISTORY_TEST_REDIS_URL").unwrap();
        let task = tokio::spawn(consume_stream_for_table(
            uri,
            name,
            table,
            10,
            100,
            50,
            shutdown,
            Arc::new(RwLock::new(())),
        ));
        time::timeout(Duration::from_secs(20), async {
            loop {
                let length: usize = conn.xlen(&key).await.unwrap();
                if length == 0 {
                    break;
                }
                time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        stop(signal, task).await;
        let log = tokio::fs::read_to_string(directory.join("_delta_log/00000000000000000001.json"))
            .await
            .unwrap();
        let committed_rows: usize = log
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter_map(|v| {
                v.get("add")
                    .and_then(|a| a.get("stats"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .map(|s| {
                serde_json::from_str::<Value>(&s).unwrap()["numRecords"]
                    .as_u64()
                    .unwrap() as usize
            })
            .sum();
        assert_eq!(
            committed_rows, 2,
            "both IPC record batches must be durably written"
        );
        assert!(std::fs::read_dir(&directory).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|s| s == "parquet")));
        let _: () = conn.del(&key).await.unwrap();
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
    #[tokio::test]
    #[ignore = "requires an isolated Redis on a port other than 6379"]
    async fn cleanup_failure_retries_without_rewriting_committed_rows() {
        let (mut conn, namespace) = crate::staging::tests::fixture().await;
        let name = namespace.replace(':', "_");
        let key = format!("history:ingest:{name}");
        let user = format!("test_{}", Uuid::new_v4().simple());
        let _: () = redis::cmd("ACL")
            .arg("SETUSER")
            .arg(&user)
            .arg("on")
            .arg(">isolated-test-only")
            .arg("~*")
            .arg("+@all")
            .arg("-xackdel")
            .query_async(&mut conn)
            .await
            .unwrap();
        let (directory, table, schema) = table_fixture().await;
        let _: String = conn
            .xadd(&key, "*", &[("data", payload(schema))])
            .await
            .unwrap();
        let mut uri =
            url::Url::parse(&std::env::var("TANGRAM_HISTORY_TEST_REDIS_URL").unwrap()).unwrap();
        uri.set_username(&user).unwrap();
        uri.set_password(Some("isolated-test-only")).unwrap();
        let (signal, shutdown) = watch::channel(false);
        let task = tokio::spawn(consume_stream_for_table(
            uri.to_string(),
            name,
            table,
            10,
            100,
            50,
            shutdown,
            Arc::new(RwLock::new(())),
        ));
        let commit = directory.join("_delta_log/00000000000000000001.json");
        time::timeout(Duration::from_secs(20), async {
            while !commit.exists() {
                time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        time::sleep(Duration::from_millis(1200)).await;
        let length: usize = conn.xlen(&key).await.unwrap();
        assert_eq!(length, 1);
        assert!(!directory
            .join("_delta_log/00000000000000000002.json")
            .exists());
        let _: () = redis::cmd("ACL")
            .arg("SETUSER")
            .arg(&user)
            .arg("+xackdel")
            .query_async(&mut conn)
            .await
            .unwrap();
        time::timeout(Duration::from_secs(10), async {
            loop {
                let n: usize = conn.xlen(&key).await.unwrap();
                if n == 0 {
                    break;
                }
                time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        stop(signal, task).await;
        assert!(
            !directory
                .join("_delta_log/00000000000000000002.json")
                .exists(),
            "ACK retries must not duplicate committed rows"
        );
        let _: usize = redis::cmd("ACL")
            .arg("DELUSER")
            .arg(&user)
            .query_async(&mut conn)
            .await
            .unwrap();
        let _: () = conn.del(&key).await.unwrap();
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an isolated Redis on a port other than 6379"]
    async fn malformed_and_failed_writes_stay_pending() {
        for malformed in [true, false] {
            let (mut conn, namespace) = crate::staging::tests::fixture().await;
            let name = namespace.replace(':', "_");
            let key = format!("history:ingest:{name}");
            let (directory, table, _) = table_fixture().await;
            let incompatible = Arc::new(ArrowSchema::new(vec![Field::new(
                "unrecognized_column",
                DataType::Int32,
                false,
            )]));
            let bytes = if malformed {
                b"not Arrow".to_vec()
            } else {
                payload(incompatible)
            };
            let _: String = conn.xadd(&key, "*", &[("data", bytes)]).await.unwrap();
            let (signal, shutdown) = watch::channel(false);
            let uri = std::env::var("TANGRAM_HISTORY_TEST_REDIS_URL").unwrap();
            let task = tokio::spawn(consume_stream_for_table(
                uri,
                name,
                table,
                10,
                100,
                50,
                shutdown,
                Arc::new(RwLock::new(())),
            ));
            time::sleep(Duration::from_secs(2)).await;
            let length: usize = conn.xlen(&key).await.unwrap();
            assert_eq!(length, 1);
            let pending: Vec<redis::Value> = redis::cmd("XPENDING")
                .arg(&key)
                .arg("history_group")
                .arg("-")
                .arg("+")
                .arg(10)
                .query_async(&mut conn)
                .await
                .unwrap();
            assert_eq!(pending.len(), 1, "never acknowledge unpersisted data");
            assert!(!directory
                .join("_delta_log/00000000000000000001.json")
                .exists());
            stop(signal, task).await;
            let _: () = conn.del(&key).await.unwrap();
            tokio::fs::remove_dir_all(directory).await.unwrap();
        }
    }
}

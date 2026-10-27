//! Acknowledgement of durably committed history staging batches.
use redis::{aio::MultiplexedConnection, streams::StreamAutoClaimReply, RedisResult};

pub(crate) const RECOVER_IDLE_MS: u64 = 60_000;

pub(crate) async fn recover_pending(
    conn: &mut MultiplexedConnection,
    stream: &str,
    group: &str,
    consumer: &str,
    cursor: &str,
    count: usize,
) -> RedisResult<StreamAutoClaimReply> {
    redis::cmd("XAUTOCLAIM")
        .arg(stream)
        .arg(group)
        .arg(consumer)
        .arg(RECOVER_IDLE_MS)
        .arg(cursor)
        .arg("COUNT")
        .arg(count)
        .query_async(conn)
        .await
}

// Redis<8.2: atomically delete only IDs actually acknowledged in the sole
// consumer group. Extra groups retain their data; never trim by arbitrary age.
const LEGACY_ACK: &str = r#"
local groups = redis.call('XINFO', 'GROUPS', KEYS[1])
local acked, deleted = 0, 0
for i=2,#ARGV do
    local n = redis.call('XACK', KEYS[1], ARGV[1], ARGV[i])
    acked = acked + n
    if n == 1 and #groups == 1 then
        deleted = deleted + redis.call('XDEL', KEYS[1], ARGV[i])
    end
end
return {acked, deleted}
"#;

pub(crate) struct Acknowledger {
    native: bool,
}
impl Default for Acknowledger {
    fn default() -> Self {
        Self { native: true }
    }
}
impl Acknowledger {
    pub(crate) async fn persisted(
        &mut self,
        conn: &mut MultiplexedConnection,
        stream: &str,
        group: &str,
        ids: &[String],
    ) -> RedisResult<()> {
        if ids.is_empty() {
            return Ok(());
        }
        if self.native {
            let reply: RedisResult<Vec<i64>> = redis::cmd("XACKDEL")
                .arg(stream)
                .arg(group)
                .arg("ACKED")
                .arg("IDS")
                .arg(ids.len())
                .arg(ids)
                .query_async(conn)
                .await;
            match reply {
                Ok(_) => return Ok(()),
                Err(error)
                    if error
                        .to_string()
                        .to_ascii_lowercase()
                        .contains("unknown command") =>
                {
                    self.native = false;
                    tracing::warn!("Redis lacks XACKDEL; legacy staging cleanup is safe only with one consumer group; extra groups retain payloads");
                }
                Err(error) => return Err(error),
            }
        }
        let _: Vec<i64> = redis::cmd("EVAL")
            .arg(LEGACY_ACK)
            .arg(1)
            .arg(stream)
            .arg(group)
            .arg(ids)
            .query_async(conn)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use redis::{
        streams::{StreamReadOptions, StreamReadReply},
        AsyncCommands, ConnectionAddr,
    };
    pub(crate) async fn fixture() -> (MultiplexedConnection, String) {
        let uri = std::env::var("TANGRAM_HISTORY_TEST_REDIS_URL")
            .expect("requires a dedicated isolated Redis, never the live instance on port 6379");
        let client = redis::Client::open(uri).unwrap();
        match client.get_connection_info().addr() {
            ConnectionAddr::Tcp(host, port) if host == "127.0.0.1" && *port != 6379 => {}
            _ => panic!("refusing a non-isolated test Redis"),
        }
        (
            client.get_multiplexed_async_connection().await.unwrap(),
            format!("test:history:{}", uuid::Uuid::new_v4()),
        )
    }
    async fn append(conn: &mut MultiplexedConnection, key: &str) -> String {
        conn.xadd(key, "*", &[("data", "small synthetic isolated-test batch")])
            .await
            .unwrap()
    }
    async fn read(conn: &mut MultiplexedConnection, key: &str, group: &str) -> String {
        let opts = StreamReadOptions::default()
            .group(group, "test-consumer")
            .count(1);
        let r: StreamReadReply = conn.xread_options(&[key], &[">"], &opts).await.unwrap();
        r.keys[0].ids[0].id.clone()
    }
    #[tokio::test]
    #[ignore = "requires TANGRAM_HISTORY_TEST_REDIS_URL pointing at an isolated Redis on a port other than 6379"]
    async fn committed_cleanup_preserves_unread_entries() {
        for native in [true, false] {
            let (mut conn, key) = fixture().await;
            let first = append(&mut conn, &key).await;
            let _second = append(&mut conn, &key).await;
            let _: () = conn.xgroup_create(&key, "history", "0-0").await.unwrap();
            assert_eq!(read(&mut conn, &key, "history").await, first);
            Acknowledger { native }
                .persisted(&mut conn, &key, "history", &[first])
                .await
                .unwrap();
            let length: usize = conn.xlen(&key).await.unwrap();
            assert_eq!(
                length, 1,
                "persisted staging copy must be removed, unread retained"
            );
            let _: () = conn.del(&key).await.unwrap();
        }
    }
    #[tokio::test]
    #[ignore = "requires isolated Redis"]
    async fn other_group_pending_data_is_not_deleted() {
        for native in [true, false] {
            let (mut conn, key) = fixture().await;
            let id = append(&mut conn, &key).await;
            for group in ["history", "other"] {
                let _: () = conn.xgroup_create(&key, group, "0-0").await.unwrap();
            }
            read(&mut conn, &key, "history").await;
            Acknowledger { native }
                .persisted(&mut conn, &key, "history", std::slice::from_ref(&id))
                .await
                .unwrap();
            let length: usize = conn.xlen(&key).await.unwrap();
            assert_eq!(length, 1);
            assert_eq!(read(&mut conn, &key, "other").await, id);
            Acknowledger { native }
                .persisted(&mut conn, &key, "other", &[id])
                .await
                .unwrap();
            let length: usize = conn.xlen(&key).await.unwrap();
            assert_eq!(length, if native { 0 } else { 1 });
            let _: () = conn.del(&key).await.unwrap();
        }
    }
    #[tokio::test]
    #[ignore = "requires isolated Redis"]
    async fn processed_stream_memory_does_not_grow_with_recording_duration() {
        for native in [true, false] {
            let (mut conn, key) = fixture().await;
            let _: () = conn
                .xgroup_create_mkstream(&key, "history", "0-0")
                .await
                .unwrap();
            let mut ack = Acknowledger { native };
            for _ in 0..1000 {
                let id = append(&mut conn, &key).await;
                assert_eq!(read(&mut conn, &key, "history").await, id);
                ack.persisted(&mut conn, &key, "history", &[id])
                    .await
                    .unwrap();
            }
            let length: usize = conn.xlen(&key).await.unwrap();
            let memory: usize = redis::cmd("MEMORY")
                .arg("USAGE")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .unwrap();
            assert_eq!(length, 0);
            assert!(
                memory < 100_000,
                "processed payloads must not accumulate: {memory}"
            );
            let _: () = conn.del(&key).await.unwrap();
        }
    }

    #[tokio::test]
    #[ignore = "requires isolated Redis"]
    async fn abandoned_pending_entries_are_recovered_not_trimmed() {
        let (mut conn, key) = fixture().await;
        let id = append(&mut conn, &key).await;
        let _: () = conn.xgroup_create(&key, "history", "0-0").await.unwrap();
        read(&mut conn, &key, "history").await;
        let active = recover_pending(&mut conn, &key, "history", "new-consumer", "0-0", 100)
            .await
            .unwrap();
        assert!(active.claimed.is_empty());
        let _: redis::Value = redis::cmd("XCLAIM")
            .arg(&key)
            .arg("history")
            .arg("test-consumer")
            .arg(0)
            .arg(&id)
            .arg("IDLE")
            .arg(RECOVER_IDLE_MS + 1)
            .query_async(&mut conn)
            .await
            .unwrap();
        let recovered = recover_pending(&mut conn, &key, "history", "new-consumer", "0-0", 100)
            .await
            .unwrap();
        assert_eq!(recovered.claimed.len(), 1);
        assert_eq!(recovered.claimed[0].id, id);
        let length: usize = conn.xlen(&key).await.unwrap();
        assert_eq!(length, 1);
        Acknowledger::default()
            .persisted(&mut conn, &key, "history", &[id])
            .await
            .unwrap();
        let length: usize = conn.xlen(&key).await.unwrap();
        assert_eq!(length, 0);
        let _: () = conn.del(&key).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires isolated Redis"]
    async fn unread_ids_cannot_be_deleted_by_acknowledgement() {
        for native in [true, false] {
            let (mut conn, key) = fixture().await;
            let id = append(&mut conn, &key).await;
            let _: () = conn.xgroup_create(&key, "history", "0-0").await.unwrap();
            Acknowledger { native }
                .persisted(&mut conn, &key, "history", &[id])
                .await
                .unwrap();
            let length: usize = conn.xlen(&key).await.unwrap();
            assert_eq!(length, 1);
            let _: () = conn.del(&key).await.unwrap();
        }
    }
}

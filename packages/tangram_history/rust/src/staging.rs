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

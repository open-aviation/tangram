import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import List, Set, Dict, Any, Optional
import time

import redis
from redis.asyncio import Redis
from redis.commands.timeseries import TimeSeries
from tangram.plugins import redis_subscriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


@dataclass
class State:
    _redis: redis.Redis = field(repr=False)

    id: str = "filter-jet1090"

    count: int = 0
    prior_count: int = 0

    forward_count: int = 0
    prior_forward_count: int = 0

    planes: Set[str] = field(default_factory=lambda: set())

    def __post_init__(self):
        if not isinstance(self._redis, redis.Redis):
            raise ValueError("A Redis connection must be provided")
        self.clean_expired_fields()

    @property
    def redis_field(self) -> Any:
        value = self._redis.get(f"{self.id}:redis_field")
        return value.decode() if value else None

    @redis_field.setter
    def redis_field(self, value: Any):
        self._redis.set(f"{self.id}:redis_field", str(value))

    def _get_hash_key(self):
        return f"{self.id}:plane-table"

    def count_field(self) -> int:
        with self._redis.pipeline() as pipe:
            pipe.hgetall(self._get_hash_key())
            [keys, *_] = pipe.execute()
        now_ts = time.time()
        results = []
        for k, v in keys.items():
            if k.endswith(":expires"):
                icao24, expires_at = k.split(":", maxsplit=1)
                if int(v) > now_ts:
                    results.append(icao24)
                else:
                    log.info("%s expires", icao24)
        log.info("keys: %s", len(results))
        log.debug("keys: %s", results)

    def exist_field(self, field: str) -> bool:
        hash_key = self._get_hash_key()
        return self._redis.hexists(hash_key, field)

    def set_field(self, field: str, value: Any, expire_time: int = 60):
        hash_key = self._get_hash_key()
        now_ts = time.time()
        value = value or now_ts
        expires_at = int(now_ts) + expire_time

        with self._redis.pipeline() as pipe:
            pipe.hset(hash_key, field, str(value))
            pipe.hset(hash_key, f"{field}:expires", str(expires_at))
            pipe.execute()

    def get_field(self, field: str) -> Optional[str]:
        hash_key = self._get_hash_key()

        with self._redis.pipeline() as pipe:
            pipe.hget(hash_key, field)
            pipe.hget(hash_key, f"{field}:expires")
            value, expires = pipe.execute()

        if value and expires:
            current_time = int(time.time())
            if current_time < int(expires):
                return value.decode()
            else:
                self._redis.hdel(hash_key, field, f"{field}:expires")
        return None

    def clean_expired_fields(self):
        log.info("clean expired fields ...")
        hash_key = self._get_hash_key()
        current_time = int(time.time())

        all_fields = self._redis.hgetall(hash_key)
        for field, value in all_fields.items():
            if field.endswith(":expires"):
                actual_field = field[:-8]  # 去掉 ":expires" 后缀
                if current_time >= int(value):
                    self._redis.hdel(hash_key, actual_field, field)
                    log.info("%s expired", actual_field)

    # def __repr__(self):
    #     return f"State(id='{self.id}', redis_field={self.redis_field})"


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str], initial_state):
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        m: Dict = json.loads(data)

        if "altitude" in m:
            fields = ["icao24", "timestamp", "altitude"]
            record = {field: m[field] for field in fields}
            log.debug("%s", record)
            await self.redis.publish("altitude", json.dumps(record))

        if "latitude" in m and "longitude" in m:
            fields = ["icao24", "timestamp", "latitude", "longitude"]
            m = {field: m[field] for field in fields}
            await self.redis.publish("jet1090", json.dumps(m))

    async def _message_handler(self, channel: str, data: str, pattern: str, state: State):
        m: Dict = json.loads(data)
        # m = {k: v for k, v in m.items() if k not in ["timestamp", "timesource", "frame", "rssi"]}
        # log.info("m: %s", m)

        # state.count += 1
        # icao24 = m["icao24"]

        # if m["icao24"] not in state.planes:
        # if not state.exist_field(icao24):
        #     log.info("new plane: %s", icao24)
        # state.planes.add(m["icao24"])
        # state.set_field(icao24, None, expire_time=60)

        if ("latitude" in m and "longitude" in m) or ("altitude" in m):
            # if "latitude" in m and "longitude" in m:
            fields = ["icao24", "timestamp", "latitude", "longitude"]
            m = {field: m[field] for field in fields}
            log.info("to pulibsh %s", m)
            await self.redis.publish("jet1090", json.dumps(m))
            # state.forward_count += 1


async def main(redis_url: str):
    redis_client = redis.Redis.from_url(redis_url, decode_responses=True, encoding="utf-8")
    # redis_client = await Redis.from_url(redis_url, decode_responses=True, encoding="utf-8")
    state = State(_redis=redis_client)

    subscriber = Subscriber("coordinate", redis_url, ["jet1090-full*"], state)
    await subscriber.subscribe()
    log.info("coordinate is up and running")

    try:
        while True:
            await asyncio.sleep(1)
            log.info(
                "planes: %-5d - count: %5d => %-5d %5d/s - forward: %5d => %-5d %5d/s",
                len(state.planes),
                state.prior_count,
                state.count,
                state.count - state.prior_count,
                state.prior_forward_count,
                state.forward_count,
                state.forward_count - state.prior_forward_count,
            )
            state.prior_count = state.count
            state.prior_forward_count = state.forward_count
            state.count_field()
            state.clean_expired_fields()
            state.count_field()
    except asyncio.CancelledError:
        print("\ruser interrupted, exiting ...")

        log.info("coordinate is shutting down")
        await subscriber.cleanup()
        log.info("coordinate exits")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", default="redis://localhost")
    args = parser.parse_args()

    try:
        asyncio.run(main(args.redis_url))
    except KeyboardInterrupt:
        print("\rbye.")

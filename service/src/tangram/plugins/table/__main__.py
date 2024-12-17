#!/usr/bin/env python
# coding: utf8

import asyncio
import logging
import json
import redis
import operator

# from redis_om import HashModel
import tangram.websocket as channels


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


async def main(redis_url: str, redis_topic: str):
    redis_client = redis.Redis.from_url(redis_url)

    # subscribe to `coordinate` topic
    pubsub = redis_client.pubsub()
    pubsub.subscribe(redis_topic)

    seq = 0
    for message in pubsub.listen():
        if message["type"] != "message":
            continue

        raw_json_data = json.loads(message["data"].decode("utf-8"))
        raw_json_data["seq"] = seq

        fields = ["icao24", "timestamp", "latitude", "longitude", "altitude"]
        if set(fields) < set(raw_json_data.keys()):
            icao24, timestamp, latitude, longitude, altitude = operator.itemgetter(*fields)(raw_json_data)
            # payload = dict(zip(fields, values))
            # data = {
            #     "el": f"data-{icao24}",
            #     "html": f"""<div class="alert alert-success" role="alert">{timestamp}, {icao24}</div>""",
            # }
            client_count = await channels.system_broadcast(channel="channel:table", event="update-row", data=raw_json_data, by_redis=False)
            log.info("%s / get message for %s, to %s", seq, raw_json_data.get("icao24"), client_count)
            seq += 1


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis", dest="redis_url", default=os.getenv("REDIS_URL"))
    parser.add_argument("--redis-topic", dest="redis_topic", default="jet1090-full")
    args = parser.parse_args()
    redis_url, redis_topic = args.redis_url, args.redis_topic

    log.info("loading with redis %s %s", redis_url, redis_topic)
    asyncio.run(main(redis_url, redis_topic))

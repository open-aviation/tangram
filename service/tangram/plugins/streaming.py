#!/usr/bin/env python
# coding: utf8

import time
import redis
import logging
from typing import Any, List
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


def jet1090_all(jet1090_service: str, api_endpoint: str = "/all") -> List[Any]:
    url = f"{jet1090_service}{api_endpoint}"
    try:
        resp = httpx.get(url)
        if resp.status_code not in [200]:
            log.error("fail to get `all` from %s, status: %s", url, resp.status_code)
            return []
        return resp.json()  # type: ignore
    except httpx.ConnectError:
        log.error("fail to connection jet1090 service, please check %s", url)
        return []
    except Exception:  # catch all
        log.exception("fail to get data from jet1090 service")
        return []


def main(jet1090_restful_service: str, redis_url: str, streamping_topic: str):
    url = f"{jet1090_restful_service}/all"
    restful_client = httpx.Client()

    redis_client = redis.Redis.from_url(redis_url)

    log.info("streaming jet1090 to WS clients ...")
    while True:
        # source_data = jet1090_all(jet1090_restful_service)
        resp = restful_client.get(url)
        redis_client.publish(streamping_topic, resp.text)
        log.info("publishing to %s %s (len: %s)...", redis_url, streamping_topic, len(resp.text))
        time.sleep(1)


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", dest="redis_url", default=os.getenv("REDIS_URL", "redis://redis:6379"))
    parser.add_argument("--streaming-topic", dest="streaming_topic", default="to:streaming:new-data")
    parser.add_argument("--jet1090-service", dest="jet1090_service", default=os.getenv("JET1090_URL", "http://jet1090:8080"))
    args = parser.parse_args()

    jet1090_service = args.jet1090_service
    main(jet1090_service, args.redis_url, args.streaming_topic)

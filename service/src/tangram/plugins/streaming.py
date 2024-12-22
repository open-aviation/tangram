#!/usr/bin/env python
# coding: utf8

import asyncio
import logging
from typing import Any, List
import httpx
import tangram.websocket as channels
# from redis.asyncio import Redis

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


async def main(jet1090_restful_service: str):
    while True:
        source_data = jet1090_all(jet1090_restful_service)
        log.info("publishing (len: %s)...", len(source_data))

        # icao24_list = set([el["icao24"] for el in source_data])
        # log.debug("unique total: %s %s", len(icao24_list), icao24_list)

        await channels.system_broadcast(channel="channel:streaming", event="new-data", data=source_data, by_redis=False)
        await asyncio.sleep(1)


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--jet1090-service", dest="jet1090_service", default=os.getenv("RS1090_SOURCE_BASE_URL"))
    args = parser.parse_args()

    jet1090_service = args.jet1090_service
    if not jet1090_service:
        log.error("missing jet1090 service")
        exit(0)
    asyncio.run(main(jet1090_service))

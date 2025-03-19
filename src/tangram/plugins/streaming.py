#!/usr/bin/env python
# coding: utf8

import json
import logging
import asyncio
from typing import Any, Dict, List, Optional

import httpx
import redis

from tangram.plugins.redis_subscriber import Subscriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


class BoundingBoxState:
    def __init__(self):
        self.north_east_lat: Optional[float] = None
        self.north_east_lng: Optional[float] = None
        self.south_west_lat: Optional[float] = None
        self.south_west_lng: Optional[float] = None
        self.is_set = False


class BoundingBoxSubscriber(Subscriber[BoundingBoxState]):
    async def message_handler(self, channel: str, data: str, pattern: str, state: BoundingBoxState):
        try:
            bbox_data = json.loads(data)
            state.north_east_lat = bbox_data.get("northEastLat")
            state.north_east_lng = bbox_data.get("northEastLng")
            state.south_west_lat = bbox_data.get("southWestLat")
            state.south_west_lng = bbox_data.get("southWestLng")
            state.is_set = True
            log.info(f"Updated bounding box: NE({state.north_east_lat},{state.north_east_lng}), " f"SW({state.south_west_lat},{state.south_west_lng})")
        except json.JSONDecodeError:
            log.error(f"Failed to parse bounding box data: {data}")
        except Exception as e:
            log.exception(f"Error processing bounding box update: {e}")


def is_within_bbox(aircraft: Dict[str, Any], bbox_state: BoundingBoxState) -> bool:
    if not bbox_state.is_set:
        return True  # If no bounding box is set, include all aircraft

    lat = aircraft.get("latitude")
    lng = aircraft.get("longitude")

    if lat is None or lng is None:
        return False

    return bbox_state.south_west_lat <= lat <= bbox_state.north_east_lat and bbox_state.south_west_lng <= lng <= bbox_state.north_east_lng


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


async def main(jet1090_restful_service: str, redis_url: str, streaming_topic: str):
    url = f"{jet1090_restful_service}/all"
    restful_client = httpx.AsyncClient()

    redis_client = redis.Redis.from_url(redis_url)

    # Initialize bounding box subscriber
    bbox_state = BoundingBoxState()
    bbox_subscriber = BoundingBoxSubscriber(name="BoundingBoxSubscriber", redis_url=redis_url, channels=["from:system:bound-box"], initial_state=bbox_state)
    await bbox_subscriber.subscribe()

    log.info("streaming jet1090 to WS clients ...")
    try:
        while True:
            resp = await restful_client.get(url)
            data = resp.json()

            # Filter aircraft based on bounding box
            if bbox_state.is_set:
                filtered_data = [aircraft for aircraft in data if is_within_bbox(aircraft, bbox_state)]
                log.info(f"Filtered {len(data) - len(filtered_data)} aircraft outside bounding box")
                data = filtered_data

            redis_client.publish(streaming_topic, json.dumps(data))
            log.info("publishing to %s %s (len: %s)...", redis_url, streaming_topic, len(data))
            await asyncio.sleep(1)
    finally:
        await bbox_subscriber.cleanup()
        await restful_client.aclose()


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis-url", dest="redis_url", default=os.getenv("REDIS_URL", "redis://redis:6379"))
    parser.add_argument("--streaming-topic", dest="streaming_topic", default="to:streaming:new-data")
    parser.add_argument("--jet1090-service", dest="jet1090_service", default=os.getenv("JET1090_URL", "http://jet1090:8080"))
    args = parser.parse_args()

    jet1090_service = args.jet1090_service

    # Run the async main function
    asyncio.run(main(jet1090_service, args.redis_url, args.streaming_topic))

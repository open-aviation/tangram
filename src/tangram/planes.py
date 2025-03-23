#!/usr/bin/env python
# coding: utf8

import asyncio
import json
import logging
from typing import Any, Dict, NoReturn, Optional

import httpx
import redis

from tangram.common.redis_subscriber import Subscriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


class BoundingBoxState:
    def __init__(self) -> None:
        # Store bounding boxes for each connection ID
        self.bboxes: dict[str, dict[str, float]] = {}
        self.clients: set[str] = set()

    def set_bbox(
        self,
        connection_id: str,
        north_east_lat: float,
        north_east_lng: float,
        south_west_lat: float,
        south_west_lng: float,
    ) -> None:
        """Set bounding box for a specific connection ID"""
        self.bboxes[connection_id] = {
            "north_east_lat": north_east_lat,
            "north_east_lng": north_east_lng,
            "south_west_lat": south_west_lat,
            "south_west_lng": south_west_lng,
        }

    def has_bbox(self, connection_id: str) -> bool:
        """Check if a connection ID has a bounding box set"""
        return connection_id in self.bboxes

    def get_bbox(self, connection_id: str) -> Optional[Dict[str, float]]:
        """Get the bounding box for a specific connection ID"""
        return self.bboxes.get(connection_id)

    def remove_bbox(self, connection_id: str) -> None:
        """Remove bounding box for a connection ID"""
        if connection_id in self.bboxes:
            del self.bboxes[connection_id]


class BoundingBoxSubscriber(Subscriber[BoundingBoxState]):
    async def message_handler(
        self, event: str, payload: str, pattern: str, state: BoundingBoxState
    ) -> None:
        log.info("event: %s, data: %s, pattern: %s", event, payload, pattern)

        if event == "from:system:join-streaming":
            try:
                connection_id = json.loads(payload)["connectionId"]
                state.clients.add(connection_id)
                log.info("+ client joins: %s, %s", payload, state.clients)
                return
            except Exception as e:
                log.exception(f"Error processing client join event: {e}")

        if event == "from:system:leave-streaming":
            try:
                connection_id = json.loads(payload)["connectionId"]
                if connection_id in state.clients:
                    state.clients.remove(connection_id)
                state.remove_bbox(connection_id)
                log.info("- client leaves: %s, %s", payload, state.clients)
                return
            except Exception as e:
                log.exception(f"Error processing client leave event: {e}")

        if event == "from:system:bound-box":
            try:
                data = json.loads(payload)
                connection_id = data.get("connectionId")
                if not connection_id:
                    log.error("Missing connectionId in bounding box data")
                    return
                # Save bounding box for this specific connection
                ne_lat, ne_lng, sw_lat, sw_lng = (
                    data.get("northEastLat"),
                    data.get("northEastLng"),
                    data.get("southWestLat"),
                    data.get("southWestLng"),
                )
                state.set_bbox(
                    connection_id=connection_id,
                    north_east_lat=ne_lat,
                    north_east_lng=ne_lng,
                    south_west_lat=sw_lat,
                    south_west_lng=sw_lng,
                )
                log.info(
                    "Updated %s bounding box: NE(%s, %s), SW(%s, %s)",
                    connection_id,
                    ne_lat,
                    ne_lng,
                    sw_lat,
                    sw_lng,
                )
            except json.JSONDecodeError:
                log.error("Failed to parse bounding box data: %s", payload)
            except Exception as e:
                log.exception(f"Error processing bounding box update: {e}")


def is_within_bbox(
    aircraft: Dict[str, Any], bbox_state: BoundingBoxState, connection_id: str
) -> bool:
    """Check if aircraft is within the bounding box for a specific connection ID"""
    # If no bounding box is set for this connection, include all aircraft
    if not bbox_state.has_bbox(connection_id):
        return True

    bbox = bbox_state.get_bbox(connection_id)
    if not bbox:
        return True

    lat: None | float = aircraft.get("latitude", None)
    lng: None | float = aircraft.get("longitude", None)
    if lat is None or lng is None:
        return False
    return (
        bbox["south_west_lat"] <= lat <= bbox["north_east_lat"]
        and bbox["south_west_lng"] <= lng <= bbox["north_east_lng"]
    )


async def main(jet1090_restful_service: str, redis_url: str) -> NoReturn:
    all_aircraft_url = jet1090_restful_service + "/all"
    restful_client = httpx.AsyncClient()
    redis_client = redis.Redis.from_url(redis_url)

    # Initialize bounding box subscriber
    bbox_state = BoundingBoxState()
    channels = [
        "from:system:*",
        "to:admin:channel.add",
    ]  # it's to:admin here, because it's designed fro WS access.
    bbox_subscriber = BoundingBoxSubscriber(
        name="BoundingBoxSubscriber",
        redis_url=redis_url,
        channels=channels,
        initial_state=bbox_state,
    )
    await bbox_subscriber.subscribe()

    log.info("streaming jet1090 to WS clients ...")
    try:
        while True:
            if not bbox_state.clients:
                await asyncio.sleep(1)
                continue

            resp = await restful_client.get(all_aircraft_url)
            all_aircraft = [el for el in resp.json() if el.get("latitude", None)]
            icao24_set = set((el["icao24"] for el in all_aircraft))

            # Apply filters per client connection and publish
            for client in bbox_state.clients:
                # Filter aircraft based on this client's bounding box
                if bbox_state.has_bbox(client):
                    filtered_data = [
                        aircraft
                        for aircraft in all_aircraft
                        if is_within_bbox(aircraft, bbox_state, client)
                    ]
                    log.info(
                        f"Client {client}: filtering, "
                        f"{len(all_aircraft)} {len(icao24_set)} => {len(filtered_data)}"
                    )
                    client_data = filtered_data
                else:
                    client_data = all_aircraft

                redis_client.publish(
                    f"to:streaming-{client}:new-data",
                    json.dumps({"count": len(all_aircraft), "aircraft": client_data}),
                )
                log.info(
                    "publishing to %s %s (len: %s)...",
                    redis_url,
                    f"to:streaming-{client}:new-data",
                    len(client_data),
                )

            await asyncio.sleep(1)
    finally:
        await bbox_subscriber.cleanup()
        await restful_client.aclose()


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--redis-url",
        dest="redis_url",
        default=os.getenv("REDIS_URL", "redis://redis:6379"),
    )
    parser.add_argument(
        "--jet1090-service",
        dest="jet1090_service",
        default=os.getenv("JET1090_URL", "http://jet1090:8080"),
    )
    args = parser.parse_args()
    asyncio.run(main(args.jet1090_service, args.redis_url))

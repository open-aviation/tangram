#!/usr/bin/env python
# coding: utf8

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any, Dict, NoReturn, Optional

import redis
import rs1090
from pydantic import BaseModel

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


class StateVector(BaseModel):
    icao24: str
    registration: None | str
    typecode: None | str
    lastseen: float
    firstseen: float
    callsign: str | None
    latitude: float | None
    longitude: float | None
    altitude: float | None
    track: float | None


def is_within_bbox(
    aircraft: StateVector, bbox_state: BoundingBoxState, connection_id: str
) -> bool:
    """Check if aircraft is within the bounding box for a specific connection ID"""
    # If no bounding box is set for this connection, include all aircraft
    if not bbox_state.has_bbox(connection_id):
        return True

    bbox = bbox_state.get_bbox(connection_id)
    if not bbox:
        return True

    if aircraft.latitude is None or aircraft.longitude is None:
        return False
    return (
        bbox["south_west_lat"] <= aircraft.latitude <= bbox["north_east_lat"]
        and bbox["south_west_lng"] <= aircraft.longitude <= bbox["north_east_lng"]
    )


class AircraftStore(dict[str, StateVector]):
    def __missing__(self, key: str) -> StateVector:
        now = int(datetime.now(UTC).timestamp())
        info = rs1090.aircraft_information(key)
        registration = info.get("registration", None)
        return StateVector(
            icao24=key,
            registration=registration,
            typecode=None,
            callsign=None,
            lastseen=now,
            firstseen=now,
            latitude=None,
            longitude=None,
            altitude=None,
            track=None,
        )


class StateVectors:
    def __init__(self) -> None:
        self.aircraft: dict[str, StateVector] = AircraftStore()

    def add(self, msg: dict[str, Any]) -> None:
        if msg["df"] not in ["17", "18"]:
            return
        if msg["bds"] not in ["05", "06", "08", "09"]:
            return
        sv = self.aircraft[msg["icao24"]]
        sv.lastseen = msg["timestamp"]
        if msg["df"] == "18":
            sv.typecode = "GRND"
        if callsign := msg.get("callsign", None):
            sv.callsign = callsign
        if altitude := msg.get("altitude", None):
            sv.altitude = altitude
        if latitude := msg.get("latitude", None):
            sv.latitude = latitude
        if longitude := msg.get("longitude", None):
            sv.longitude = longitude
        if track := msg.get("track", None):
            sv.track = track
        self.aircraft[msg["icao24"]] = sv


class Jet1090Subscriber(Subscriber[StateVectors]):
    async def message_handler(
        self, event: str, payload: str, pattern: str, state: StateVectors
    ) -> None:
        msg = json.loads(payload)
        state.add(msg)


async def main(jet1090_restful_service: str, redis_url: str) -> NoReturn:
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

    state_vectors = StateVectors()
    sv_subscriber = Jet1090Subscriber(
        name="Jet1090Subscriber",
        redis_url=redis_url,
        channels=["jet1090"],
        initial_state=state_vectors,
    )
    await sv_subscriber.subscribe()

    log.info("streaming jet1090 to WS clients ...")
    try:
        while True:
            if not bbox_state.clients:
                await asyncio.sleep(1)
                continue

            # resp = await restful_client.get(all_aircraft_url)

            now = datetime.now(UTC).timestamp()
            all_aircraft = [
                el
                for el in state_vectors.aircraft.values()
                if el.latitude is not None and el.lastseen > now - 600
            ]
            icao24_set = set((el.icao24 for el in all_aircraft))

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
                    json.dumps(
                        {
                            "count": len(all_aircraft),
                            "aircraft": [vars(ac) for ac in client_data],
                        },
                    ),
                )
                log.info(
                    "publishing to %s %s (len: %s)...",
                    redis_url,
                    f"to:streaming-{client}:new-data",
                    len(client_data),
                )

            await asyncio.sleep(1)
    except Exception as exc:
        log.info(exc)
        raise
    finally:
        await bbox_subscriber.cleanup()
        # await restful_client.aclose()


if __name__ == "__main__":
    import argparse
    import os

    file_handler = logging.FileHandler("/tmp/tangram/planes.log")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
    log.addHandler(file_handler)
    log.setLevel(logging.DEBUG)

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

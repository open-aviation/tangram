#!/usr/bin/env python
# coding: utf8

import asyncio
from dataclasses import dataclass
import json
from tangram.util import logging
from typing import Dict, List

from pydantic import BaseModel
from tangram.plugins import redis_subscriber

log = logging.getPluginLogger(
    __package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG, add_console_handler=False
)


keys = {
    5: ["timestamp", "timesource", "rssi", "frame", "df", "squawk", "icao24"],
    18: [
        "timestamp",
        "timesource",
        "rssi",
        "frame",
        "df",
        "tisb",
        "icao24",
        "bds",
        "NUCp",
        "groundspeed",
        "track",
        "parity",
        "lat_cpr",
        "lon_cpr",
    ],
    11: ["timestamp", "timesource", "rssi", "frame", "df", "capability", "icao24"],
    17: [
        "timestamp",
        "timesource",
        "rssi",
        "frame",
        "df",
        "icao24",
        "bds",
        "NUCp",
        "NICb",
        "altitude",
        "source",
        "parity",
        "lat_cpr",
        "lon_cpr",
        "latitude",
        "longitude",
    ],
    4: ["timestamp", "timesource", "rssi", "frame", "df", "altitude", "icao24"],
    21: [
        "timestamp",
        "timesource",
        "rssi",
        "frame",
        "df",
        "squawk",
        "bds",
        "selected_mcp",
        "barometric_setting",
        "icao24",
    ],
    16: [
        "timestamp",
        "timesource",
        "rssi",
        "frame",
        "df",
        "vs",
        "sl",
        "ri",
        "altitude",
        "icao24",
    ],
    20: [
        "timestamp",
        "timesource",
        "rssi",
        "frame",
        "df",
        "altitude",
        "bds",
        "selected_mcp",
        "barometric_setting",
        "icao24",
    ],
    0: ["timestamp", "timesource", "rssi", "frame", "df", "altitude", "icao24"],
}


class Base(BaseModel):
    timestamp: float
    timesource: str
    frame: str
    df: int
    icao24: str


class Extended(Base):
    rssi: float | None = None
    capability: str | None = None
    altitude: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    groundspeed: float | None = None
    track: float | None = None
    barometric_setting: float | None = None
    selected_mcp: int | None = None
    bds: str | int | None = None
    Mach: float | None = None
    vrate_inertial: float | None = None
    heading: float | None = None
    IAS: int | None = None
    squawk: str | None = None
    vrate_barometric: float | None = None
    NUCp: int | None = None
    NICb: int | None = None
    parity: str | None = None
    lat_cpr: int | None = None
    lon_cpr: int | None = None
    ri: int | None = None
    sl: int | None = None
    vs: int | None = None
    NACv: int | None = None
    track: float | None = None
    vertical_rate: float | None = None
    geo_minus_baro: int | None = None
    vrate_src: str | None = None
    TAS: int | None = None
    track_rate: float | None = None
    roll: float | None = None
    source: str | None = None
    selected_heading: float | None = None
    selected_altitude: int | None = None
    NACp: int | None = None
    tcas_operational: bool | None = None
    selected_fms: int | None = None
    callsign: str | None = None
    traget_source: float | None = None
    emergency_state: str | None = None
    subtype: str | None = None
    tisb: str | None = None
    SIL: int | None = None
    version: int | None = None
    GVA: int | None = None
    NICa: int | None = None
    BAI: int | None = None
    SILs: int | None = None
    HRD: int | None = None
    target_source: str | None = None
    wake_vortex: str | None = None
    TAH: int | None = None
    alt_hold: int | None = None
    lnav_mode: bool | None = None
    vnav_mode: bool | None = None
    approach_mode: bool | None = None
    autopilot: bool | None = None
    dte: int | None = None
    identification: int | None = None
    mode_s: int | None = None
    level5: int | None = None
    gicb: int | None = None
    acas_ra: int | None = None
    acas: int | None = None
    config: int | None = None
    subnet: int | None = None
    sic: int | None = None
    squitter: int | None = None
    ovc: int | None = None
    acas_hybrid: int | None = None
    bds20: int | None = None
    bds50: int | None = None
    bds07: int | None = None
    bds5f: int | None = None
    bds40: int | None = None
    bds60: int | None = None
    bds06: int | None = None
    bds09: int | None = None
    bds52: int | None = None
    bds0a: int | None = None
    bds51: int | None = None
    bds05: int | None = None
    bds08: int | None = None
    bds21: int | None = None
    bds53: int | None = None
    temperature: float | None = None
    turbulence: float | None = None
    wind_direction: float | None = None
    wind_speed: float | None = None
    pressure: float | None = None
    humidity: float | None = None


fields = set(Extended.model_fields.keys())


@dataclass
class State:
    pass


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        message_dict = json.loads(data)
        # message = Extended(**message_dict)
        # log.debug('%s', message)

        if "latitude" in message_dict and "longitude" in message_dict:
            await self.redis.publish("coordinate", data)


subscriber: Subscriber | None = None


async def startup(redis_url: str):
    global subscriber

    subscriber = Subscriber("coordinate", redis_url, ["jet1090*"])
    await subscriber.subscribe()
    log.info("coordinate is up and running")


async def shutdown():
    global subscriber

    if subscriber:
        await subscriber.cleanup()
    log.info("coordinate exits")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("redis_url")
    args = parser.parse_args()
    asyncio.run(startup(args.redis_url))

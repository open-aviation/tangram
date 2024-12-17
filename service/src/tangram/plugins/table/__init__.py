#!/usr/bin/env python
# coding: utf8

import logging
import redis
from redis_om import HashModel
import tangram.websocket as tangram_websocket

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


class TableRecord(HashModel):
    icao24: str

    first_timestamp: float
    latest_timestamp: float

    latitude: float
    longitude: float
    altitude: float

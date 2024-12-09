import json
from dataclasses import dataclass, field
from typing import Iterable, List
import logging

from tangram import websocket as channels
from tangram.plugins import redis_subscriber
from tangram.plugins.history import HistoryDB
from tangram.util import logging as tangram_logging

tangram_log = logging.getLogger("tangram")
log = tangram_logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)


@dataclass
class State:
    icao24: str | None = None
    trajectory: List[Iterable[float]] = field(default_factory=list)  #  lat, longi


class Subscriber(redis_subscriber.Subscriber[State]):
    def __init__(self, name: str, redis_url: str, channels: List[str]):
        self.history_db = HistoryDB(use_memory=False)

        initial_state = State()
        super().__init__(name, redis_url, channels, initial_state)

    async def message_handler(self, channel: str, data: str, pattern: str, state: State):
        # log.debug("selected: %s, got: %s %s", state.icao24, channel, data)

        if channel == "coordinate" and state.icao24:
            # log.debug("coordinate data: %s", data)

            timed_message = json.loads(data)
            if timed_message["icao24"] == state.icao24:
                icao24, latitude, longitude = timed_message["icao24"], timed_message["latitude"], timed_message["longitude"]
                await self.redis.publish("trajectory", json.dumps(timed_message))

                # Two options here:
                # 1. iddeally, we just push [lat, lng] point to UI. as long as the trajectory is properly cached
                # trajectory = [latitude, longitude]
                #
                # 2. full trajectory
                history_trajectory = [[el["latitude"], el["longitude"]] for el in self.history_db.list_tracks(icao24)]
                log.info("loaded history from %s", self.history_db.get_db_file())

                trajectory = history_trajectory + [[latitude, longitude]]
                await channels.publish_any(f"channel:trajectory:{state.icao24}", "new-data", trajectory)
                log.info("redis `trajectory`, icao24: %s - latitude: %s, longitude: %s, len: %s", state.icao24, latitude, longitude, len(trajectory))

        if channel == "channel:system:select":
            log.debug("system select, data: %s", data)

            message_list = json.loads(data)
            if len(message_list) != 5:
                log.warning("message_list: %s", message_list)
                return

            [ref, join_ref, channel, event, payload] = message_list
            log.debug("channel: %s, event: %s, payload: %s", channel, event, payload)

            icao24 = payload["icao24"]
            state.icao24 = icao24
            state.trajectory = [[el["latitude"], el["longitude"]] for el in self.history_db.list_tracks(icao24)]
            log.info("select a different plane: %s", state.icao24)


subscriber: Subscriber | None = None


async def startup(redis_url: str):
    global subscriber

    tangram_log.info("trajectory_subsctiber is starting ...")
    subscriber = Subscriber("trajectory_subscriber", redis_url=redis_url, channels=["coordinate", "channel:system:*"])
    await subscriber.subscribe()
    tangram_log.info("trajectory_subsctiber is up and running")


async def shutdown():
    global subscriber

    tangram_log.info("trajectory_subsctiber is shuting down ...")
    if subscriber:
        await subscriber.cleanup()
    tangram_log.info("trajectory_subsctiber exits")

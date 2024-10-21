import asyncio
import logging
from typing import Optional

from fastapi import APIRouter
from tangram import websocket as channels
from tangram.plugins.common.rs1090 import websocket_client
from tangram.websocket import ChannelHandlerMixin, ClientMessage, register_channel_handler
from tangram.plugins.history import HistoryDB

log = logging.getLogger(__name__)


class TrajectoryChannelHandler(ChannelHandlerMixin):
    def will_handle_channel(self, channel_name: str) -> bool:
        return channel_name.lower().startswith(self.channel_name)


trajectory_channel_handler = TrajectoryChannelHandler("channel:trajectory")
register_channel_handler(trajectory_channel_handler)


class Runner:
    def __init__(self, trajectory_channel_handler):
        self.history_db = HistoryDB()

        self.trajectory_channel_handler = trajectory_channel_handler
        self.trajectory_channel_handler.register_channel_event_handler(
            self.handle_join, "channel:trajectory:*", "join", obj=self
        )
        self.trajectory_channel_handler.register_channel_event_handler(
            self.handle_streaming_select, "channel:streaming", "event:select", obj=self
        )
        self.selected_icao24: Optional[str] = None

        self.running = True
        self.counter = 0
        self.task = None
        self.latest_track_ts: None | float = None

        self.jet1090_data_channel: websocket_client.ClientChannel = (
            websocket_client.jet1090_websocket_client.add_channel("jet1090")
        )
        self.jet1090_data_channel.on_event("join", self.on_jet1090_joining)
        self.jet1090_data_channel.on_event("data", self.on_jet1090_data)

    async def handle_join(self, client_id: str, message: ClientMessage):
        log.info("TJ Runner - %s joins %s", client_id, message.topic)

        icao24 = message.topic.split(":")[-1]
        self.selected_icao24 = icao24

        result_items = [[item["latitude"], item["longitude"]] for item in self.history_db.list_tracks(icao24)]
        await channels.publish_any(f"channel:trajectory:{icao24}", "new-data", result_items) # pushes historical trajectory

    async def handle_streaming_select(self, client_id: str, message: ClientMessage):
        # TODO: looks into this from UI side, it's not triggered
        self.selected_icao24 = message.payload["icao24"]
        log.info("TJ Runner - selected_icao24 updated: %s", self.selected_icao24)

    async def on_jet1090_joining(self, join_ref, ref, channel, event, status, response):
        log.info("TJ Runner, joined: %s, response: %s", channel, response)

    async def on_jet1090_data(self, join_ref, ref, channel, event, status, response):
        timed_message = response.get("timed_message")
        # log.debug('TJ Runner, got data: %s', timed_message)

        # client side filtering by icao24
        if self.selected_icao24 is None or (
            self.selected_icao24 and (timed_message.get("icao24") != self.selected_icao24)
        ):
            # log.debug("selected %s, ignore %s", self.selected_icao24, timed_message.get("icao24"))
            return

        # filter on the client side: i.e df = 17
        # we are also interested in timestamp, which is always there
        if not (timed_message.get("latitude") and timed_message.get("longitude") and timed_message.get("timestamp")):
            # log.debug("filtered out %s", timed_message)
            return

        includes = ["df", "icao24", "timestamp", "latitude", "longitude", "altitude"]
        item = {("last" if k == "timestamp" else k): timed_message.get(k) for k in includes}

        result_items = [
            [item["latitude"], item["longitude"]] for item in self.history_db.list_tracks(item["icao24"])
        ] + [[item["latitude"], item["longitude"]]]
        await channels.publish_any(f"channel:trajectory:{item['icao24']}", "new-data", result_items)
        log.info("pushed to %s, %s", self.selected_icao24, item)

    async def startup(self) -> None:
        self.task = asyncio.create_task(self.run(), name='trajectory-task')
        log.debug("TJ / trajectory task created")

    async def run(self, internal_seconds: int = 7):
        """launch job here"""
        log.info("TJ / starting ...")
        await self.jet1090_data_channel.join_async()

        log.info("TJ / running ...")
        while self.running:
            self.counter += 1
            await asyncio.sleep(internal_seconds)  # one second
        log.info("TJ / job done")

    async def shutdown(self):
        log.info("TJ / shuting down task: %s", self.task.get_name())
        if self.task is None:
            log.warning("runner task is None")
            return

        if self.task.done():
            result = self.task.result()
            log.info("TJ / task is done, got result: %s", result)
        else:
            log.info('TJ / canceling task ...')
            self.task.cancel()
            log.warning("TJ / task %s is canceled", self.task.get_name())


app = Runner(trajectory_channel_handler)

# app = APIRouter(
#     prefix="/plugins/trajectory",
#     on_startup=[runner.startup],
#     on_shutdown=[runner.shutdown],
# )

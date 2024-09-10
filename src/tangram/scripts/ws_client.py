#!/usr/bin/env python
# coding: utf8

import asyncio
import logging
from tangram.plugins.common.rs1090.websocket_client import jet1090_websocket_client
import redis

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


redis_client = redis.Redis.from_url("redis://192.168.8.34:6379/0")


async def main(ws_url: str):
    def on_joining(_join_ref, _ref, channel, event, status, response) -> None:  # noqa
        log.info("joined %s/%s, status: %s, response: %s", channel, event, status, response)

    def on_heartbeat(join_ref, ref, channel, event, status, response) -> None:  # noqa
        log.info("heartbeat: %s", response)

    def on_datetime(join_ref, ref, channel, event, status, response) -> None:  # noqa
        log.info("join_ref: %s, ref: %s, datetime: %s", join_ref, ref, response)

    def on_jet1090_message(join_ref, ref, channel, event, status, response) -> None:  # noqa
        skipped_fields = ["timestamp", "timesource", "system", "frame"]
        log.info("jet1090: %s", {k: v for k, v in response["timed_message"].items() if k not in skipped_fields})

    await jet1090_websocket_client.connect_async(ws_url)

    async def system_channel_job():
        system_channel = jet1090_websocket_client.add_channel("system")
        system_channel.on_event("join", on_joining)
        system_channel.on_event("datetime", on_datetime)
        await system_channel.join_async()

    async def jet1090_channel_job():
        jet1090_channel = jet1090_websocket_client.add_channel("jet1090")
        jet1090_channel.on_event("join", on_joining)
        jet1090_channel.on_event("heartbeat", on_heartbeat)
        jet1090_channel.on_event("data", on_jet1090_message)
        await jet1090_channel.join_async()

    system_channel_task = asyncio.create_task(system_channel_job())
    log.info("t1 created: %s", system_channel_task)

    jet1090_channel_task = asyncio.create_task(jet1090_channel_job())
    log.info("t2 created: %s", jet1090_channel_task)

    await jet1090_websocket_client.start_async()
    # FIXME: tasks are not canceled


if __name__ == "__main__":
    import argparse

    default_websocket_url = "ws://127.0.0.1:8080/websocket"
    parser = argparse.ArgumentParser()
    parser.add_argument("-u", "--websocket-url", dest="websocket_url", type=str, default=default_websocket_url)
    parser.add_argument(
        "-l", "--log-level", dest="log_level", default="info", choices=["debug", "info", "warning", "error", "critical"]
    )
    args = parser.parse_args()
    log.setLevel(args.log_level.upper())

    try:
        asyncio.run(main(args.websocket_url))
    except KeyboardInterrupt:
        print("\rbye.")

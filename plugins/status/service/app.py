#!/usr/bin/env python
# coding: utf8

import anyio
import redis_om

from tangram import Tangram


class State(redis_om.JsonModel):
    now: str


# run migrations to set up the indexes that Redis OM will use. Or, use the `migrate` CLI tool for this!
# redis_om.Migrator().run()


app = Tangram("status")


@app.handler("system", "*")
async def handle_notification(data):
    app.logger.info("received event: %s", data)


@app.task()
async def publish_notification():
    while True:
        await app.publish("system", "time", {})
        await anyio.sleep(5)


if __name__ == "__main__":
    anyio.run(app.run)

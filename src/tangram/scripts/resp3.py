import logging
import time

import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(filename)s:%(lineno)s - %(message)s")
log = logging.getLogger(__name__)


def subscribe(channel_name: str, redis_url: str):
    r = redis.Redis.from_url(redis_url, decode_responses=True, protocol=3)

    hello_response = r.execute_command("HELLO", 3)  # switch to RESP3
    log.info("HELLO response: %s", hello_response)

    pubsub = r.pubsub()
    pubsub.subscribe(channel_name)

    for message in pubsub.listen():
        if message["type"] == "message":
            log.info("received message: %s", message["data"])


def track(redis_url: str):
    r = redis.Redis.from_url(redis_url, protocol=3, decode_responses=True)
    log.info("track in %s", r.client_id())

    pubsub = r.pubsub()
    pubsub.psubscribe("__redis__:*")

    # for message in pubsub.listen():
    # log.info("in track, values: %s", message)
    # if message["type"] == "message":
    #     log.info("Invalidation received: %s", message["data"])

    while True:
        message = pubsub.get_message()
        if message:
            log.info("in track %s", message)
            # do something with the message
        time.sleep(0.001)  # be


def track_on(redis_url: str):
    # does it have to be a different client?
    tracking_connection = redis.Redis.from_url(redis_url, protocol=3, decode_responses=True)
    log.info("tracking_connection: %s", tracking_connection.client_info())

    client_id = tracking_connection.client_id()
    log.info("trakcing in %s", client_id)

    # r = redis.Redis.from_url(redis_url, protocol=3, decode_responses=True)
    # log.info("r info: %s", r.client_info())

    # https://redis.io/docs/latest/commands/client-tracking/
    # r.execute_command("CLIENT", "TRACKING", "ON", "REDIRECT", client_id)

    # in a different client, set 'tracked-key' 'new-value'
    # for example
    # r.set("tracked-key", "new-value")

    log.info("listening for key change notifications ...")
    while True:
        notification = tracking_connection.execute_command("XREAD", "BLOCK", 0, "STREAMS", "__redis__:invalidate", "$")
        if notification:
            log.info("Key change notification: %s", notification)

    # cleanup
    # pubsub.unsubscribe()
    # r.execute_command("CLIENT", "TRACKING", "OFF")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("redis_url")
    parser.add_argument("command")
    args = parser.parse_args()

    redis_url = args.redis_url
    topic = "hello-resp3"
    match args.command:
        case "subscribe":
            subscribe(topic, redis_url)
        case "track-on":
            track_on(redis_url)
        case "track":
            track(redis_url)

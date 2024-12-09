import logging

from redis.asyncio import Redis

from tangram.util import logging as tangram_logging

tangram_log = logging.getLogger(__name__)
log = tangram_logging.getPluginLogger(__package__, __name__, "/tmp/tangram/", log_level=logging.DEBUG)

selected_icao24 = None

# TODO Listen to Redis topic and handle events

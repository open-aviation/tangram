import asyncio
import logging

from tangram.plugins import history

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)

async def main(redis_url):
    try:
        tasks = await history.startup(redis_url)
        # gather or wait for tasks
        await asyncio.gather(*tasks)
    except Exception as exec:  # noqa
        log.exception(f"Error starting up history plugin: {exec}")
        await history.shutdown()


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--redis", dest='redis_url', help="redis url, or use REDIS_URL environment variable which take precedence")
    args = parser.parse_args()

    if (redis_url := os.getenv('REDIS_URL')) is not None:
        log.info('using redis from environment variable REDIS_URL: %s', redis_url)
    elif ((redis_url := args.redis_url)) is None:
        log.warning("No REDIS_URL found in environment variable, please specify it using --redis option")
        exit(1)
    else:
        log.info('using redis from option --redis: %s', redis_url)
    asyncio.run(main(redis_url))

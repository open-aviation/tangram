#!/usr/bin/env python
# coding: utf8

import argparse
import pathlib
import json
import uvicorn
from tangram.settings import tangram_settings, TANGRAM_PACKAGE_ROOT
from tangram.util.geojson import BetterJsonEncoder


def main():
    parser = argparse.ArgumentParser('tangram cli')
    parser.add_argument('--config', type=pathlib.Path, help=f'config file (default: {TANGRAM_PACKAGE_ROOT / "settings.yml"})')
    parser.add_argument('command', choices=['run', 'dump-config'], help='tangram commands')

    parser.add_argument('--host', type=str, help=f'serving host (default: {tangram_settings.host})')
    parser.add_argument('--port', type=int, help=f'serving port (defautl: {tangram_settings.port})')
    parser.add_argument('--reload', action='store_true', default=False, help=f'hot reload (default: {tangram_settings.reload})')
    args = parser.parse_args()

    if args.command == 'dump-config':
        print(json.dumps(tangram_settings.model_dump(), indent=2, cls=BetterJsonEncoder))
        return

    uvicorn_config = uvicorn.Config(
        app='tangram.app:app',
        ws='websockets',
        host=args.host or tangram_settings.host,
        port=args.port or tangram_settings.port,
        reload=args.reload or tangram_settings.reload,
        log_config=tangram_settings.log_config,
    )
    try:
        uvicorn.Server(uvicorn_config).run()
    except KeyboardInterrupt:
        print('\rbye.')


if __name__ == '__main__':
    main()

#!/usr/bin/env python
# coding: utf8

import uvicorn


def main():
    # TODO from cli parameters, config file or from a typed config class
    config = {
        'app': 'tangram.app:app',
        'host': '0.0.0.0',
        'port': 18000,
        'log_level': 'info',
        'ws': 'websockets',
        'reload': True,
    }
    server = uvicorn.Server(uvicorn.Config(**config))
    server.run()


if __name__ == '__main__':
    main()

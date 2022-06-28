import logging
import os
from requests import Session
from traffic.core import Traffic
import zmq

os.environ["no_proxy"] = "localhost"
REQUEST_TIMEOUT = 5500


class Decoder:
    def __init__(self, base_url: str = "tcp://127.0.0.1:5050") -> None:
        self.context = zmq.Context()
        self.socket = self.context.socket(zmq.REQ)
        self.socket.connect(base_url)
        self.base_url = base_url

    def traffic_records(self, start: str = "") -> Traffic:
        request = [start.encode(encoding='utf8'), b"traffic"]
        traffic = None
        try:
            self.socket.send_multipart(request)
            if (self.socket.poll(REQUEST_TIMEOUT) & zmq.POLLIN) != 0:
                traffic = self.socket.recv_pyobj()
        except Exception as e:
            logging.warning("decoder" + str(e))
            self.stop()
            self.context = zmq.Context()
            self.socket = self.context.socket(zmq.REQ)
            self.socket.connect(self.base_url)
            traffic = None
        return traffic

    def stop(self):
        self.socket.setsockopt(zmq.LINGER, 0)
        self.socket.close()
        self.context.term()


class Aggregator:
    def __init__(self, base_url: str = "http://localhost:5054") -> None:
        self.session = Session()
        self.base_url = base_url

    def icao24(
        self,
        icao24: str,
    ):
        c = self.session.get(self.base_url, params={"icao": icao24})
        c.raise_for_status()

        return c.json()

    def get_planes(self):
        c = self.session.get(self.base_url)
        c.raise_for_status()

        return c.json()

    def traffic_records(self):
        try:
            c = self.session.get(self.base_url + "/traffic")
            c.raise_for_status()
        except Exception as e:
            logging.warning("decoder" + str(e))
            return {"traffic": None}
        return c.json()

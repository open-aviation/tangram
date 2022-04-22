import logging
import os

from requests import Session

os.environ["no_proxy"] = "127.0.0.1"


class Decoder():
    def __init__(self, base_url: str = "http://127.0.0.1:5050") -> None:
        self.session = Session()
        self.base_url = base_url

    def icao24(
        self,
        icao24: str,
    ):
        c = self.session.get(
            self.base_url,
            params={"icao": icao24}
        )
        c.raise_for_status()

        return c.json()

    def get_planes(self):
        c = self.session.get(
            self.base_url)
        c.raise_for_status()

        return c.json()

    def traffic_records(self):
        try:
            c = self.session.get(
                self.base_url + "/cumul"
            )
            c.raise_for_status()
        except Exception as e:
            logging.warning(e)
            return {"cumul": []}
        return c.json()

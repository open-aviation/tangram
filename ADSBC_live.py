import time
import pyModeS as pms
from queue import Queue
from collections import defaultdict
from pyModeS.extra.tcpclient import TcpClient
from concurrent.futures import ThreadPoolExecutor

from pyModeS.py_common import data


class ADSBClient(TcpClient):

    def __init__(self, host, port, rawtype):
        super(ADSBClient, self).__init__(host, port, rawtype)
        self.queue = Queue()
        self.df_raw = {}

    def handle_messages(self, messages):
        for msg, ts in messages:
            icao = pms.adsb.icao(msg)
            tc = pms.adsb.typecode(msg)
            self.queue.put({"ts": ts, "icao": icao, "msg": msg, "tc": tc})
            if self.queue.qsize() > 30000:
                self.queue.get()

    def get_queue(self):
        return self.queue


def calculate_results(resultats: list) -> dict:
    data = defaultdict(lambda: [])
    for mesure in resultats:
        id = mesure["icao"]
        if id is None:
            id = "None"
        data[id].append(
            {"ts": mesure["ts"], "msg": mesure["msg"], "tc": mesure["tc"]})

    dict_min = {}
    tester = defaultdict(lambda: [])
    for id in data.keys():
        data_icao = [x for x in data[id]]
        for mesure in data_icao:
            msg = mesure["msg"]
            if 5 <= mesure["tc"] <= 8 or 9 <= mesure["tc"] <= 18 or 20 <= mesure["tc"] <= 22:
                position = pms.adsb.position_with_ref(
                    msg, lon_ref=1.4752, lat_ref=43.57153)
                mesure["ps"] = position
                tester[id].append(mesure)
                # on peut mettre tester[id][0]
                tester[id] = [min(tester[id], key=lambda item: item["ts"])]

        dict_min[id] = min(data_icao, key=lambda item: item["ts"])

    print(len(dict_min))
    print(len(tester))
    return tester


def nb_vol(client: ADSBClient) -> dict:
    q = client.get_queue()
    data_cache = list(q.queue)
    return calculate_results(data_cache)


def run_client(client: ADSBClient):
    client.run()


def main(client: ADSBClient):
    executor = ThreadPoolExecutor(max_workers=2)
    executor.submit(run_client, client)

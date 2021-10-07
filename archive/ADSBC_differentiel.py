from collections import defaultdict
import pyModeS as pms
from pyModeS.extra.tcpclient import TcpClient
from concurrent.futures import ThreadPoolExecutor
from queue import Queue, Empty


class ADSBClient(TcpClient):
    def __init__(self, host, port, rawtype, queue):
        super(ADSBClient, self).__init__(host, port, rawtype)
        self.queue = queue
        self.i = 0

    def handle_messages(self, messages):
        if self.i > 8000:
            self.stop()
        for msg, ts in messages:
            self.i += 1
            icao = pms.adsb.icao(msg)
            self.queue.put((ts, icao))


def tester(q):
    client = ADSBClient(host='radarcape', port=10005, rawtype='beast', queue=q)
    client.run()


def reader(q):
    resultat = []
    while True:
        try:
            resultat.append(q.get(timeout=0.3))
        except Empty:
            break
    return resultat


def calculate_results(resultats):
    data = defaultdict(lambda: [])
    for mesure in resultats:
        id = mesure[1]
        if id is None:
            id = "None"
        data[id].append(mesure[0])
    resultats = {}
    for id in data.keys():
        d = [x for x in data[id]]
        resultats[id] = min(d)
    print(resultats)
    print(len(resultats.keys()))
    return resultats


def main():
    q = Queue()
    # t=threading.Thread(target=tester, daemon=True,args=(q,))
    # t2=threading.Thread(target=reader,daemon=True,args=(q,))
    # t.start()
    # t2.start()
    # t.join()
    # t2.join()
    executor = ThreadPoolExecutor(max_workers=2)
    t = executor.submit(tester, q)
    t2 = executor.submit(reader, q)
    return calculate_results(t2.result())

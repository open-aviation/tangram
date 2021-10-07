import threading
import pyModeS as pms
from pyModeS.extra.tcpclient import TcpClient
from streamz import Stream
from streamz.core import collect
import json
from streamz import Stream

class ADSBClient(TcpClient):
    def __init__(self, host, port, rawtype):
        super(ADSBClient, self).__init__(host, port, rawtype)
        self.stream = Stream()
        self.stream.sink(self.writejson)
        self.file=open('myfile.json','w')

    def __exit__(self):
        self.file.close()

    def writejson(self,data):
            self.file.write(json.dumps(data,indent=4))

    def handle_messages(self, messages):
        for msg, ts in messages:
            icao = pms.adsb.icao(msg)
            tc = pms.adsb.typecode(msg)
            self.stream.emit((ts,icao))

def tester():
    client = ADSBClient(host='radarcape', port=10005, rawtype='beast')
    client.run()
def reader():
    text = Stream.from_textfile('myfile.json')
    text.sink(print)
    text.start()

t=threading.Thread(target=tester, daemon=True)
t2=threading.Thread(target=reader,daemon=True)
t.start()
t2.start()
t.join()



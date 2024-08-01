import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import numpy as np
import pandas as pd
from pymongo import MongoClient
from pymongo.cursor import Cursor
from pymongo.database import Database
from pymongo.errors import OperationFailure
from traffic.core.traffic import Traffic
from traffic.data import aircraft

from tangram.util.geojson import BetterJsonEncoder
from ..util.zmq_sockets import DecoderSocket

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(filename)s:%(lineno)s - %(message)s')
log = logging.getLogger(__name__)


def crit(df: pd.DataFrame) -> pd.Series:
    return (
        (df.vertical_rate_barometric_std - df.vertical_rate_inertial_std)
        .abs()
        .where(df.vertical_rate_barometric_count > 20, None)
    )


def threshold(df: pd.DataFrame) -> float:
    t: float = np.mean(df.criterion) + TurbulenceClient.multiplier * np.std(df.criterion)
    if t > TurbulenceClient.min_threshold:
        return t
    else:
        return TurbulenceClient.min_threshold


def turbulence(df: pd.DataFrame) -> pd.Series:
    if TurbulenceClient.demo:
        return df.criterion > df.threshold + 100
    return df.criterion > df.threshold


def expire_turb(df: pd.DataFrame) -> pd.Series:
    return (df.timestamp + pd.Timedelta("20T")).where(df.turbulence, None)


def intensity_turb(df: pd.DataFrame) -> pd.Series:
    return df.criterion - df.threshold


def anomaly(df: pd.DataFrame) -> pd.Series:
    lat_1 = df.latitude > (np.mean(df.latitude) + 3 * np.std(df.latitude))
    lat_2 = df.latitude < (np.mean(df.latitude) - 3 * np.std(df.latitude))
    lon_3 = df.longitude > (np.mean(df.longitude) + 3 * np.std(df.longitude))
    lon_4 = df.longitude < (np.mean(df.longitude) - 3 * np.std(df.longitude))
    return lat_1 | lat_2 | lon_3 | lon_4


def altitude_fill(df: pd.DataFrame) -> pd.Series:
    return df.altitude.ffill().bfill()


class TurbulenceClient:
    min_threshold: float = 180
    multiplier: float = 1.3
    demo: bool = False

    def __init__(self, decoders: dict[str, str] | str = "tcp://localhost:5050") -> None:
        import threading

        self.running: bool = False
        if isinstance(decoders, str):
            decoders = {"": decoders}
        self.decoders: dict[str, DecoderSocket] = {
            name: DecoderSocket(address) for name, address in decoders.items()
        }
        log.info('Turb decoders: %s', list(self.decoders.keys()))

        self._pro_data: Optional[Traffic] = None
        self._traffic: Optional[Traffic] = None
        self.thread: Optional[threading.Thread] = None

        mongo_client: MongoClient = MongoClient()
        self.db: Database = mongo_client.get_database(name="adsb")

    def dump_threshold(self, icao24: str, thres: float, start: pd.Timestamp, stop: pd.Timestamp) -> None:
        try:
            self.db.threshold.insert_one({"icao24": icao24, "threshold": thres, "start": str(start), "stop": str(stop)})
        except OperationFailure as e:
            log.warning("dump" + str(e))

    @property
    def pro_data(self) -> Optional[Traffic]:
        return self._pro_data

    @property
    def traffic(self) -> Optional[Traffic]:
        return self._traffic

    def traffic_decoder(self, decoder_name: str) -> Optional[Traffic]:
        traffic: Optional[Traffic] = self.decoders[decoder_name].traffic_records()
        if traffic is None:
            return None
        # add antenna to the traffic if it does not exist
        return traffic.assign(antenna=decoder_name) if "antenna" not in traffic.data.columns else traffic

    def resample_traffic(self, traffic: Traffic) -> Optional[Traffic]:
        return (
            traffic.longer_than("1T")
            .resample(
                "1s",
                how={
                    "interpolate":  # TODO simplify this
                        set(traffic.data.columns).union({"track_unwrapped", "heading_unwrapped"}) - 
                          {"vertical_rate_barometric", "vertical_rate_inertial"}
                },
            )
            .eval(max_workers=1)
        )

    def calculate_traffic(self) -> None:
        log.info('decoders: %s', list(self.decoders.keys()))

        traffic_decoders = None
        with ThreadPoolExecutor(max_workers=3) as executor:
            traffic_decoders = list(executor.map(self.traffic_decoder, self.decoders))
            log.info('%s', type(traffic_decoders[0]))

        traffic = sum(t for t in traffic_decoders if t is not None)
        log.info('traffic: %s', traffic)
        if traffic == 0:
            self._traffic = None
            return

        traffic: Optional[Traffic] = self.resample_traffic(traffic)
        self._traffic = traffic.merge(aircraft.data[["icao24", "typecode"]], how="left") if traffic is not None else traffic
        log.info('traffic updated')
        del traffic  # TOB?

    def set_min_threshold(self, value: float) -> None:
        TurbulenceClient.min_threshold = value

    def set_multiplier(self, value: float) -> None:
        TurbulenceClient.multiplier = value

    def get_min_threshold(self) -> float:
        return TurbulenceClient.min_threshold

    def get_multiplier(self) -> float:
        return TurbulenceClient.multiplier

    def turbulence(self) -> None:
        if self._traffic is not None:
            pro_data = (
                self._traffic.agg_time(
                    # aggregate data over intervals of one minute
                    "1 min",
                    # compute the std of the data
                    vertical_rate_inertial="std",
                    vertical_rate_barometric=["std", "count"],
                    # reduce one minute to one point
                    latitude="mean",
                    longitude="mean",
                )
                .assign(
                    # we define a criterion based on the
                    # difference between two standard deviations
                    # on windows of one minute
                    criterion=crit,
                    altitude=altitude_fill,
                )
                .assign(
                    # we define a thushold based on the
                    # mean criterion + 1.3 * standar deviation criterion
                    threshold=threshold
                )
                .assign(
                    # True if creterion >= threshold
                    turbulence=turbulence,
                    # intensity of the turbulence is the
                    # difference between criterion and threshold
                    intensity_turb=intensity_turb,
                )
                .assign(
                    expire_turb=expire_turb,
                    anomaly=anomaly,
                )
                .eval(max_workers=1)
            )
            self._pro_data = (
                pro_data.query("not anomaly") if pro_data is not None else None
            )
            del pro_data
        else:
            self._pro_data = None

    def calculate_live_turbulence(self) -> None:
        while self.running:
            self.calculate_traffic()
            self.turbulence()

    def start_live(self) -> None:
        self.running = True
        self.thread = threading.Thread(target=self.calculate_live_turbulence, daemon=True)
        self.thread.start()

    def start_from_database(self, data: Cursor) -> None:
        self.clear()
        df = pd.concat([pd.DataFrame.from_records(f["traj"]) for f in data])
        df["timestamp"] = pd.to_datetime(df.timestamp, utc=True)
        self._traffic = self.resample_traffic(Traffic(df))
        if self.traffic is not None:
            self._traffic = self.traffic.merge(
                aircraft.data[["icao24", "typecode"]],
                how="left",
            )
        self.turbulence()

    def stop(self) -> None:
        self.running = False
        if self.thread is not None and self.thread.is_alive():
            self.thread.join()

    def clear(self) -> None:
        self._traffic = None
        self._pro_data = None


if __name__ == '__main__':
    """
    - add decoders.dev1 in ~/.config/traffic/traffic.conf
    - launch decoder: python src/tangram/scripts/decoder.py -v dev1
    
    this script does not read it automatically, use the command parameters properly
    """
    import argparse
    import requests
    from tangram.util import geojson
    
    parser = argparse.ArgumentParser()
    parser.add_argument('-n', '--decoder-name', dest='decoder_name', type=str, default='dev1')
    parser.add_argument('--decoder-serve-host', dest='decoder_zmq_host', type=str, default='127.0.0.1')
    parser.add_argument('--decoder-serve-port', dest='decoder_zmq_port', type=int, default=5052)
    parser.add_argument('--publish-url', dest='publish_url', type=str,
                        default='http://127.0.0.1:18000/admin/publish')
    parser.add_argument('--traffic-channel', dest='traffic_channel', type=str, default='channel:streaming')
    parser.add_argument('--turb-channel', dest='turb_channel', type=str, default='channel:streaming')
    parser.add_argument('--traffic-event-name', dest='traffic_event_name', type=str, default='new-traffic')
    parser.add_argument('--turb-event-name', dest='turb_event_name', type=str, default='new-turb')

    args = parser.parse_args()
    decoder_name, zmq_host, zmq_port = args.decoder_name, args.decoder_zmq_host, args.decoder_zmq_port
    publish_url, traffic_channel, turb_channel = args.publish_url, args.traffic_channel, args.turb_channel
    traffic_event_name: str = args.traffic_event_name
    turb_event_name: str = args.turb_event_name
    
    log.info('launch new turbulence client, decoder %s at %s:%s  ...', decoder_name, zmq_host, zmq_port)
    tb = TurbulenceClient(decoders={decoder_name: f'tcp://{zmq_host}:{zmq_port}'})
    tb.start_live()

    log.info('turbulence client running ...')
    try:
        while tb.running:
            traffic: Traffic = tb.traffic
            if traffic:
                traffic_json = geojson.geojson_traffic(traffic)
                log.info('traffic, keys: %s, count: %s', traffic_json.keys(), traffic_json['count'])
                # payload = {
                #     'channel': traffic_channel,
                #     'event': traffic_event_name,
                #     'message': json.dumps(traffic_json, cls=BetterJsonEncoder),
                # }
                # requests.post(publish_url, json=payload)

            turb = tb.pro_data
            if turb:
                turb_json = geojson.geojson_turbulence(turb)
                log.info('turbulence, keys: %s, count: %s', turb_json.keys(), turb_json['count'])
                # payload = {
                #     'channel': turb_channel,
                #     'event': turb_event_name,
                #     'message': json.dumps(turb_json, cls=BetterJsonEncoder),
                # }
                # requests.post(publish_url, json=payload)
    except KeyboardInterrupt:
        # TODO cleanup
        print('\ruser interrupted, exit ...')

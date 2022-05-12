from __future__ import annotations

import base64
import logging
import pickle
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from pymongo import MongoClient
from pymongo.cursor import Cursor
from pymongo.database import Database
from traffic.core.traffic import Traffic
from traffic.data import ModeS_Decoder

import numpy as np
import pandas as pd

from .modes_decoder_client import Decoder


def crit(df: pd.DataFrame) -> pd.Series:
    return (
        df.vertical_rate_barometric_std - df.vertical_rate_inertial_std
    ).abs().where(df.vertical_rate_barometric_count > 15, None)


def threshold(df: pd.DataFrame) -> float:
    t = np.mean(df.criterion) + ADSBClient.multiplier * np.std(df.criterion)
    if t > ADSBClient.min_threshold:
        return t
    else:
        return ADSBClient.min_threshold


def longitude_fill(df: pd.DataFrame) -> pd.Series:
    return df.longitude.interpolate().bfill().ffill()


def latitude_fill(df: pd.DataFrame) -> pd.Series:
    return df.latitude.interpolate().bfill().ffill()


def altitude_fill(df: pd.DataFrame) -> pd.Series:
    return df.altitude.bfill().ffill()


def turbulence(df: pd.DataFrame) -> pd.Series:
    return df.criterion > df.threshold


def expire_turb(df: pd.DataFrame) -> pd.Series:
    return (df.timestamp + pd.Timedelta("30T")).where(df.turbulence, None)


def anomaly(df) -> pd.Series:
    lat_1 = df.latitude > (np.mean(df.latitude) + 3 * np.std(df.latitude))
    lat_2 = df.latitude < (np.mean(df.latitude) - 3 * np.std(df.latitude))
    lon_3 = df.longitude > (np.mean(df.longitude) + 3 * np.std(df.longitude))
    lon_4 = df.longitude < (np.mean(df.longitude) - 3 * np.std(df.longitude))
    return lat_1 | lat_2 | lon_3 | lon_4


class ADSBClient:
    min_threshold: float = 150
    multiplier: float = 1.2

    def __init__(
        self,
        decoders: dict[str, str] | str = "http://localhost:5050"
    ) -> None:
        self.running: bool = False
        if isinstance(decoders, str):
            decoders = {"": decoders}
        self.decoders: dict[str, Decoder] = {
            name : Decoder(address) for name, address in decoders.items()
        }
        self._pro_data: Traffic = None
        self._traffic: Traffic = None
        self.thread: threading.Thread = None
        mongo_client: MongoClient = MongoClient()
        self.db: Database = mongo_client.get_database(name="adsb")

    def dump_threshold(self, icao24: str, thres: float, start, stop):
        try:
            self.db.threshold.insert_one(
                {
                    "icao24": icao24,
                    "threshold": thres,
                    "start": str(start),
                    "stop": str(stop),
                }
            )
        except Exception as e:
            logging.warning("dump" + str(e))

    @property
    def pro_data(self) -> Traffic:
        return self._pro_data

    @property
    def traffic(self) -> Traffic:
        return self._traffic

    def traffic_decoder(self, decoder_name : str) -> Traffic | None:
        traffic_pickled = self.decoders[decoder_name].traffic_records()["traffic"]
        if traffic_pickled is None:
            return None
        try:
            traffic = pickle.loads(base64.b64decode(traffic_pickled.encode()))
        except Exception as e:
            logging.warning("pickle: " + str(e))
            traffic = None
        return traffic.assign(
            antenna=decoder_name
        )

    def resample_traffic(self, traffic: Traffic) -> Traffic:
        return (
            traffic.longer_than("1T")
            .resample(
                "1s",
                how={
                    "interpolate": set(traffic.data.columns).union(
                        {"track_unwrapped", "heading_unwrapped"}
                    )
                    - {"vertical_rate_barometric", "vertical_rate_inertial"}
                },
            )
            .eval(max_workers=4)
        )

    def calculate_traffic(self) -> None:
        traffic_decoders = None
        with ThreadPoolExecutor(max_workers=4) as executor:
            traffic_decoders = list(
                executor.map(self.traffic_decoder, self.decoders)
            )
        traffic_decoders = filter(lambda t: t is not None, traffic_decoders)
        traffic = sum(traffic_decoders)
        if traffic == 0:
            self._traffic = None
            return
        self._traffic = self.resample_traffic(traffic)

    def set_min_threshold(self, value: float) -> None:
        ADSBClient.min_threshold = value

    def set_multiplier(self, value: float) -> None:
        ADSBClient.multiplier = value

    def get_min_threshold(self) -> float:
        return ADSBClient.min_threshold

    def get_multiplier(self) -> float:
        return ADSBClient.multiplier

    def turbulence(self) -> None:
        if self._traffic is not None:
            try:
                pro_data = (
                    self._traffic.longer_than("1T")
                    .filter(
                        strategy=None,
                        # median filters for abnormal points
                        vertical_rate_barometric=3,
                        vertical_rate_inertial=3,  # kernel sizes
                        latitude=13,
                        longitude=13,
                    )
                    .assign(
                        longitude=longitude_fill,
                        latitude=latitude_fill,
                        altitude=altitude_fill,
                    )
                    .agg_time(
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
                        criterion=crit
                    )
                    .assign(
                        # we define a thushold based on the
                        # mean criterion + 1.2 * standar deviation criterion
                        threshold=threshold
                    )
                    .assign(turbulence=turbulence)
                    .assign(
                        expire_turb=expire_turb,
                        anomaly=anomaly
                    )
                    .eval(max_workers=4)
                )
            except Exception as e:
                logging.warning("turbulence" + str(e))
                raise e
            self._pro_data = (
                pro_data.query("not anomaly") if pro_data is not None else None
            )
        else:
            self._pro_data = None

    def calculate_live_turbulence(self) -> None:
        while self.running:
            self.calculate_traffic()
            self.turbulence()
            time.sleep(10)

    def start_live(self) -> None:
        self.running = True
        self.thread = threading.Thread(
            target=self.calculate_live_turbulence,
            daemon=False,
        )
        self.thread.start()

    def start_from_file(self, file: str, reference: str) -> None:
        self.clear()
        if file.endswith(".csv"):
            file_decoder = ModeS_Decoder.from_file(
                file, template="time,df,icao,shortmsg", reference=reference
            )
            self._traffic = self.resample_traffic(file_decoder.traffic)
            self.turbulence()
        elif file.endswith(".pkl") or file.endswith(".parquet"):
            self._traffic = Traffic.from_file(file)
            self._pro_data = self._traffic

    def start_from_database(self, data: Cursor) -> None:
        self.clear()
        df = pd.concat(
            [
                pd.DataFrame.from_records(f["traj"]).assign(
                    callsign=f["callsign"]
                )
                for f in data
            ]
        )
        df["timestamp"] = pd.to_datetime(df.timestamp, utc=True)
        self._traffic = self.resample_traffic(Traffic(df))
        self.turbulence()

    def stop(self) -> None:
        self.running = False
        self.thread.join()

    def clear(self) -> None:
        self._traffic = None
        self._pro_data = None

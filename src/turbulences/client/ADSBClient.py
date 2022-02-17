import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone

import numpy as np
import pandas as pd
from traffic.core.traffic import Traffic
from traffic.data import ModeS_Decoder


def crit(df):
    return (
        df.vertical_rate_barometric_std - df.vertical_rate_inertial_std
    ).abs()


def threshold(df):
    t = np.mean(df.criterion) + 1.2 * np.std(df.criterion)
    if t > 150:
        return t
    else:
        return 150


def turbulence(df):
    return df.criterion > df.threshold


class ADSBClient:
    def __init__(self) -> None:
        self.running: bool = False
        self.history: bool = False
        self.decoder: ModeS_Decoder = None
        self._pro_data: Traffic = None  #: Dict[pd.Timestamp, Traffic] = {}
        self._traffic: Traffic = None
        self.lock_traffic = threading.Lock()

    @property
    def pro_data(self):
        # last entry
        return self._pro_data

    @property
    def traffic(self):
        # last entry
        return self._traffic

    def calculate_traffic(self):
        with self.lock_traffic:
            erreur = True
            while erreur:
                try:
                    traffic = self.decoder.traffic
                    erreur = False
                except:
                    pass
            if traffic is None:
                self._traffic = None
                return
            self._traffic = (
                traffic.longer_than("1T")
                # .last("30T")  # historique ne peut pas avoir ca
                .resample("1s").eval(max_workers=4)
            )

    def turbulence(self, condition: bool):
        if condition:
            self.calculate_traffic()
        if self._traffic is not None:
            with self.lock_traffic:
                try:
                    self._pro_data = (
                        self._traffic.longer_than("1T")
                        .resample("1s")
                        .filter(  # .last("30T")
                            strategy=None,
                            # median filters for abnormal points
                            vertical_rate_barometric=3,
                            vertical_rate_inertial=3,  # kernel sizes
                        )
                        .agg_time(
                            # aggregate data over intervals of one minute
                            "1 min",
                            # compute the std of the data
                            vertical_rate_inertial="std",
                            vertical_rate_barometric="std",
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
                        .eval(max_workers=4)
                    )
                except Exception as e:
                    print(e)
        else:
            self._pro_data = None

    def calculate_live_turbulence(self):
        while self.running:
            self.turbulence(True)
            time.sleep(1)

    def start_live(self, host: str, port: int, reference: str):
        if self.history:
            self.clear()
            self.history = False
        self.running = True
        self.decoder = ModeS_Decoder.from_address(host, port, reference)
        executor = ThreadPoolExecutor(max_workers=4)
        executor.submit(self.calculate_live_turbulence)
        executor.submit(self.clean_decoder)

    def start_from_file(self, file: str, reference: str):
        self.history = True
        self.stop()
        self.clear()
        if file.endswith(".csv"):
            self.decoder = ModeS_Decoder.from_file(
                file, template="time,df,icao,shortmsg", reference=reference
            )
            self.turbulence(True)
        elif file.endswith(".pkl"):
            self._traffic = Traffic.from_file(file)
            self.turbulence(False)

    def __exit__(self):
        self.stop()

    def stop(self):
        if self.decoder is not None:
            self.decoder.stop()
        self.running = False

    def clear(self):
        with self.lock_traffic:
            self._traffic = None
            self._pro_data = None

    def clean_decoder(self):
        while self.running or len(self.decoder.acs.keys()) != 0:
            time.sleep(60)
            for icao in list(self.decoder.acs.keys()):
                condition = True
                with self.lock_traffic:
                    if len(self.decoder.acs[icao].cumul) > 0:
                        condition = False
                        if pd.Timestamp(
                            "now", tzinfo=timezone.utc
                        ) - self.decoder.acs[icao].cumul[-1][
                            "timestamp"
                        ] >= timedelta(
                            minutes=30
                        ):
                            del self.decoder.acs[icao]
                if condition:
                    if self.decoder.acs[icao].flight is not None:
                        if pd.Timestamp(
                            "now", tzinfo=timezone.utc
                        ) - self.decoder.acs[icao].flight.stop >= timedelta(
                            minutes=30
                        ):
                            with self.lock_traffic:
                                del self.decoder.acs[icao]

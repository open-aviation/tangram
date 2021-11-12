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


def thrushold(df):
    return np.mean(df.criterion) + 1.2 * np.std(df.criterion)


def turbulence(df):
    return df.criterion > df.thrushold


class ADSBClient:
    def __init__(self, host: str, port: int, reference: str) -> None:
        self.host = host
        self.port = port
        self.reference = reference
        self.terminate = False
        self.decoder = None
        self._pro_data: Traffic = None  #: Dict[pd.Timestamp, Traffic] = {}
        self.lock_prodata = threading.Lock()

    def __exit__(self):
        self.stop()

    def clean_decoder(self):
        while not self.terminate:
            for icao in list(self.decoder.acs.keys()):
                condition = True
                with self.decoder.acs[icao].lock:
                    if len(self.decoder.acs[icao].cumul) > 0:
                        condition = False
                        if pd.Timestamp(
                            "now", tzinfo=timezone.utc
                        ) - self.decoder.acs[icao].cumul[-1][
                            "timestamp"
                        ] >= timedelta(
                            hours=1
                        ):
                            del self.decoder.acs[icao]
                if condition and self.decoder.acs[icao].flight is not None:
                    if pd.Timestamp(
                        "now", tzinfo=timezone.utc
                    ) - self.decoder.acs[icao].flight.stop >= timedelta(
                        hours=1
                    ):
                        with self.decoder.acs[icao].lock:
                            del self.decoder.acs[icao]

    def calculate_turbulence(self):

        while not self.terminate:

            t = self.decoder.traffic

            if t is not None:
                with self.lock_prodata:
                    self._pro_data = (
                        t.longer_than("1T")
                        .last("30T")
                        .resample("1s")
                        .filter(  # median filters for abnormal points
                            vertical_rate_barometric=3,
                            vertical_rate_inertial=3,  # kernel sizes
                            strategy=None,  # invalid data becomes NaN
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
                            thrushold=thrushold
                        )
                        .assign(turbulence=turbulence)
                        .eval(max_workers=4)
                    )
            time.sleep(1)

    @property
    def pro_data(self):
        # last entry
        with self.lock_prodata:
            return self._pro_data

    def start(self):
        self.decoder = ModeS_Decoder.from_address(
            self.host, self.port, self.reference
        )
        executor = ThreadPoolExecutor(max_workers=4)
        executor.submit(self.calculate_turbulence)
        executor.submit(self.clean_decoder)

    def stop(self):
        self.decoder.stop()
        self.terminate = True

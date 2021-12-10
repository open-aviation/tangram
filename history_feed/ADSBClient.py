import numpy as np
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
    def __init__(self) -> None:
        self.decoder: ModeS_Decoder = None
        self._pro_data: Traffic = None  #: Dict[pd.Timestamp, Traffic] = {}
        self._traffic: Traffic = None

    @property
    def pro_data(self):
        # last entry
        return self._pro_data

    @property
    def traffic(self):
        # last entry
        return self._traffic

    def calculate_traffic(self):
        try:
            self._traffic = (
                self.decoder.traffic.longer_than("1T")
                # .last("30T")
                .resample("1s").eval(max_workers=8)
            )
        except Exception as e:
            print(e)

    def turbulence(self, condition_decoder: bool):
        if condition_decoder:
            self.calculate_traffic()
        if self._traffic is not None:
            try:
                self._pro_data = (
                    self._traffic.resample("1s")  # .last("30T")
                    .filter(
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
                        thrushold=thrushold
                    )
                    .assign(turbulence=turbulence)
                    .eval(max_workers=8)
                )
            except Exception as e:
                print(e)

    def start_from_file(self, file: str, reference: str):
        if file.endswith(".csv"):
            self.decoder = ModeS_Decoder.from_file(
                file, template="time,df,icao,shortmsg", reference=reference
            )
            self.turbulence(True)
        elif file.endswith(".pkl"):
            print("oui")
            self._traffic = Traffic.from_file(file)
            print(self._traffic)
            self.turbulence(False)
            print(self._pro_data)

    def clear(self):
        self._traffic = None
        self._pro_data = None

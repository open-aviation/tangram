import configparser
from pathlib import Path

from appdirs import user_config_dir


config_dir = Path(user_config_dir("atmlab"))
config_file = config_dir / "atmlab.conf"
config_turb = configparser.ConfigParser()
config_turb.read(config_file.as_posix())

config_file = config_dir / "decoder.conf"
config_decoder = configparser.ConfigParser()
config_decoder.read(config_file.as_posix())

config_file = config_dir / "aggregator.conf"
config_agg = configparser.ConfigParser()
config_agg.read(config_file.as_posix())

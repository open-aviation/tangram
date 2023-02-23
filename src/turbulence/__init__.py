import configparser
from pathlib import Path

from appdirs import user_config_dir

config_dir = Path(user_config_dir("traffic"))
config_file = config_dir / "traffic.conf"
config_turb = configparser.ConfigParser()
config_turb.read(config_file.as_posix())

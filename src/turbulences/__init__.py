import configparser
from pathlib import Path

from appdirs import user_config_dir

config_dir = Path(user_config_dir("atmlab"))
config_file = config_dir / "atmlab.conf"
config = configparser.ConfigParser()
config.read(config_file.as_posix())

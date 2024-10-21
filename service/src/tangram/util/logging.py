import logging
from logging.handlers import RotatingFileHandler
import pathlib
from logging import INFO, DEBUG  # noqa
import os

if not os.getenv("LOG_DIR"):
    raise ValueError("LOG_DIR environment variable not set")
log_dir = pathlib.Path(os.getenv("LOG_DIR"))


def getLogger(
    name: str, log_path: pathlib.Path, log_level: int = INFO, add_console_handler: bool = False
) -> logging.Logger:
    """
    Configure and return a logger object with specified module name and log path.
    The log level is retrieved from the LOG_LEVEL environment variable.

    :param name: Name of the logger
    :param log_path: Path where the log file will be created
    :return: Configured logger object
    """
    logger = logging.getLogger(name)
    logger.propagate = False
    logger.setLevel(log_level)

    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(name)s - %(lineno)s - %(message)s")

    if add_console_handler:
        console_handler = logging.StreamHandler()
        console_handler.setLevel(log_level)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    file_handler = RotatingFileHandler(log_path, maxBytes=10 * 1024 * 1024, backupCount=5)
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def getPluginLogger(package: str | None, name: str, log_dir: str | pathlib.Path, **kwargs) -> logging.Logger:
    """
    Configure and return a logger object with specified plugin name and log path.
    The log level is retrieved from the LOG_LEVEL environment variable.

    :param package: Name of the package, __package__
    :param name: Name of the plugin, __name__
    :return: Configured logger object
    """
    # when it's used in a ad-hoc script, the package is None
    plugin_name = "plugin-script" if (package is None or name == "__main__") else name[len(package) + 1 :]

    # module __init__.py will have the same, tangram.plugins.history.__init__.py for example
    plugin_name = name.split(".")[-1] if not plugin_name else plugin_name

    log_dir = pathlib.Path(log_dir) if isinstance(log_dir, str) else log_dir
    return getLogger(plugin_name, log_dir / f"{plugin_name}.log", **kwargs)

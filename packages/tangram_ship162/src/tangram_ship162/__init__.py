from dataclasses import dataclass

import tangram
from pydantic import TypeAdapter

plugin = tangram.Plugin(frontend_path="dist-frontend")


@dataclass(frozen=True)
class ShipsConfig:
    ship162_channel: str = "ship162"
    history_expire: int = 600  # 10 minutes
    stream_interval_secs: float = 1.0
    log_level: str = "INFO"
    python_tracing_subscriber: bool = False


@plugin.register_service()
async def run_ships(backend_state: tangram.BackendState) -> None:
    from . import _ships

    plugin_config = backend_state.config.plugins.get("tangram_ship162", {})
    config_ships = TypeAdapter(ShipsConfig).validate_python(plugin_config)

    default_log_level = plugin_config.get(
        "log_level", backend_state.config.core.log_level
    )

    if config_ships.python_tracing_subscriber:
        layer = tangram.TracingLayer()
        _ships.init_tracing_python(layer, default_log_level)
    else:
        _ships.init_tracing_stderr(default_log_level)

    rust_config = _ships.ShipsConfig(
        redis_url=backend_state.config.core.redis_url,
        ship162_channel=config_ships.ship162_channel,
        history_expire=config_ships.history_expire,
        stream_interval_secs=config_ships.stream_interval_secs,
    )
    await _ships.run_ships(rust_config)

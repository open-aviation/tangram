import logging
from typing import TYPE_CHECKING

import tangram_core
from pydantic import TypeAdapter

from .config import HistoryConfig

if TYPE_CHECKING:
    from typer import Typer

log = logging.getLogger(__name__)


def get_typer() -> Typer:
    from .cli import app

    return app


plugin = tangram_core.Plugin(get_typer=get_typer)


@plugin.register_service()
async def run_history(backend_state: tangram_core.BackendState) -> None:
    from . import _history

    plugin_config = backend_state.config.plugins.get("tangram_history", {})
    config_history = TypeAdapter(HistoryConfig).validate_python(plugin_config)

    default_log_level = plugin_config.get(
        "log_level", backend_state.config.core.log_level
    )

    _history.init_tracing_stderr(default_log_level)

    config_history.base_path.mkdir(parents=True, exist_ok=True)
    rust_config = _history.HistoryConfig(
        redis_url=backend_state.config.core.redis_url,
        control_channel=config_history.control_channel,
        base_path=str(config_history.base_path),
        redis_read_count=config_history.redis_read_count,
        redis_read_block_ms=config_history.redis_read_block_ms,
    )
    await _history.run_history(rust_config)

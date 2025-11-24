import logging
from dataclasses import dataclass
from pathlib import Path

import platformdirs
import tangram_core
from pydantic import TypeAdapter

log = logging.getLogger(__name__)
plugin = tangram_core.Plugin()


@dataclass(frozen=True)
class HistoryConfig:
    control_channel: str = "history:control"
    base_path: Path = Path(platformdirs.user_cache_dir("tangram_history"))
    log_level: str = "INFO"
    redis_read_count: int = 1000
    redis_read_block_ms: int = 5000


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

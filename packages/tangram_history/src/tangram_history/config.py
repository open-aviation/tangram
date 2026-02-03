from dataclasses import dataclass
from pathlib import Path

import platformdirs


@dataclass(frozen=True)
class HistoryConfig:
    control_channel: str = "history:control"
    base_path: Path = Path(platformdirs.user_cache_dir("tangram_history"))
    log_level: str = "INFO"
    redis_read_count: int = 1000
    redis_read_block_ms: int = 5000

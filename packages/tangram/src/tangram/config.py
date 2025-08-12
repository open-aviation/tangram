import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8000


@dataclass
class ChannelConfig:
    host: str = "127.0.0.1"
    port: int = 2347
    jwt_secret: str = "secret"
    jwt_expiration_secs: int = 315360000  # 10 years


@dataclass
class CoreConfig:
    redis_url: str = "redis://127.0.0.1:6379"
    plugins: list[str] = field(default_factory=list)


@dataclass
class TangramConfig:
    core: CoreConfig = field(default_factory=CoreConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    channel: ChannelConfig = field(default_factory=ChannelConfig)


def parse_config(config_path: Path):
    if sys.version_info < (3, 11):
        import tomli as tomllib
    else:
        import tomllib
    from pydantic import TypeAdapter

    with open(config_path, "rb") as f:
        cfg_data = tomllib.load(f)

    config_adapter = TypeAdapter(TangramConfig)
    config = config_adapter.validate_python(cfg_data)
    return config

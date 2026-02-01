from dataclasses import dataclass
from typing import Annotated

import tangram_core
from tangram_core.config import FrontendMutable


@dataclass
class GlobeConfig:
    enabled: bool = False


@dataclass
class GlobeFrontendConfig:
    enabled: Annotated[bool, FrontendMutable()]


def into_frontend(config: GlobeConfig) -> GlobeFrontendConfig:
    return GlobeFrontendConfig(enabled=config.enabled)


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    config_class=GlobeConfig,
    frontend_config_class=GlobeFrontendConfig,
    into_frontend_config_function=into_frontend,
)

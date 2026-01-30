from dataclasses import dataclass
from typing import Annotated

import tangram_core
from tangram_core.config import FrontendMutable


@dataclass
class GlobeConfig:
    enabled: Annotated[bool, FrontendMutable()] = False


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    config_class=GlobeConfig,
)

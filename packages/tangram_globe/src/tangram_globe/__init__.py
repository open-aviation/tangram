from dataclasses import dataclass
from typing import Annotated

import tangram_core
from tangram_core.config import ExposeField


@dataclass
class GlobeConfig(tangram_core.config.HasSidebarUiConfig):
    topbar_order: Annotated[int, ExposeField()] = 1000


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    config_class=GlobeConfig,
)

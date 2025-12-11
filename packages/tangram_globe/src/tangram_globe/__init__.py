from dataclasses import dataclass
from typing import Any

import tangram_core


@dataclass
class GlobeConfig(tangram_core.config.HasSidebarUiConfig):
    topbar_order: int = 1000


def transform_config(config_dict: dict[str, Any]) -> GlobeConfig:
    from pydantic import TypeAdapter

    return TypeAdapter(GlobeConfig).validate_python(config_dict)


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend", into_frontend_config_function=transform_config
)

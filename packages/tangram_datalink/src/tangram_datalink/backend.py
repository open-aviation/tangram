from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Any, Optional

import tangram_core
from fastapi import APIRouter
from pydantic import TypeAdapter
from tangram_core.config import FrontendMutable

log = logging.getLogger(__name__)

router = APIRouter(prefix="/datalink", tags=["datalink"])


@dataclass(frozen=True)
class DatalinkConfig:
    state_vector_expire: int = 3600
    stream_interval_secs: float = 1.0
    log_level: str = "INFO"
    topbar_order: int = 90
    sidebar_order: int = 90


@dataclass(frozen=True)
class DatalinkFrontendConfig(
    tangram_core.config.HasTopbarUiConfig, tangram_core.config.HasSidebarUiConfig
):
    topbar_order: Annotated[int, FrontendMutable()]
    sidebar_order: Annotated[int, FrontendMutable()]
    # Anchor for the entity filter custom widget; actual state lives in the frontend store.
    filter_ui: Annotated[Optional[Any], FrontendMutable(widget="datalink-filter")] = None


def into_frontend(config: DatalinkConfig) -> DatalinkFrontendConfig:
    return DatalinkFrontendConfig(
        topbar_order=config.topbar_order,
        sidebar_order=config.sidebar_order,
    )


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    routers=[router],
    config_class=DatalinkConfig,
    frontend_config_class=DatalinkFrontendConfig,
    into_frontend_config_function=into_frontend,
)


@plugin.register_service()
async def run_datalink(backend_state: tangram_core.BackendState) -> None:
    from . import _datalink

    plugin_config = backend_state.config.plugins.get("tangram_datalink", {})
    config_datalink = TypeAdapter(DatalinkConfig).validate_python(plugin_config)

    rust_config = _datalink.DatalinkConfig(
        redis_url=backend_state.config.core.redis_url,
        state_vector_expire=config_datalink.state_vector_expire,
        stream_interval_secs=config_datalink.stream_interval_secs,
    )
    await _datalink.run_datalink(rust_config)

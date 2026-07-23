"""tangram_navaid plugin: navaid / fix / Field 15 route search for tangram.

Pure-frontend plugin: there is no backend router. The thin Python wrapper only
declares the (optional) configuration that is forwarded to the frontend
`install()` so the Vue/TS side knows which navigation-data sources to attach.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Optional

import tangram_core
from tangram_core.config import FrontendMutable


@dataclass
class TangramNavaidConfig:
    """Backend configuration for tangram_navaid (read from [plugins.tangram_navaid])."""

    ddr_archive_url: Optional[str] = None
    """URL of a EUROCONTROL DDR2 AIRAC archive for full European route
    resolution (airway expansion + airports). When unset, the plugin falls back
    to its bundled default archive so routes still resolve."""

    traffic_js_url: Optional[str] = None
    """Self-hosted traffic.js ESM build URL. Defaults to the esm.sh CDN."""

    enable_faa: bool = False
    """Attach the FAA ArcGIS United States navigation source."""


@dataclass
class TangramNavaidFrontendConfig:
    ddr_archive_url: Annotated[Optional[str], FrontendMutable()] = None
    traffic_js_url: Annotated[Optional[str], FrontendMutable()] = None
    enable_faa: Annotated[bool, FrontendMutable()] = False


def into_frontend(config: TangramNavaidConfig) -> TangramNavaidFrontendConfig:
    return TangramNavaidFrontendConfig(
        ddr_archive_url=config.ddr_archive_url,
        traffic_js_url=config.traffic_js_url,
        enable_faa=config.enable_faa,
    )


plugin = tangram_core.Plugin(
    frontend_path="dist-frontend",
    config_class=TangramNavaidConfig,
    frontend_config_class=TangramNavaidFrontendConfig,
    into_frontend_config_function=into_frontend,
)

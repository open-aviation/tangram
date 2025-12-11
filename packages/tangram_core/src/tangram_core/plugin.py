from __future__ import annotations

import asyncio
import functools
import importlib.metadata
import logging
import traceback
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypeAlias

from fastapi import APIRouter

if TYPE_CHECKING:
    from .backend import BackendState

    ServiceAsyncFunc: TypeAlias = Callable[[BackendState], Awaitable[None]]
    ServiceFunc: TypeAlias = ServiceAsyncFunc | Callable[[BackendState], None]
    Priority: TypeAlias = int
    IntoFrontendConfigFunction: TypeAlias = Callable[[dict[str, Any]], Any]

logger = logging.getLogger(__name__)


@dataclass
class Plugin:
    """Stores the metadata and registered API routes, background services and
    frontend assets for a tangram plugin.

    Packages should declare an entry point in the `tangram_core.plugins` group
    in their `pyproject.toml` pointing to an instance of this class.
    """

    frontend_path: str | None = None
    """Path to the compiled frontend assets, *relative* to the distribution root
    (editable) or package root (wheel).
    """
    routers: list[APIRouter] = field(default_factory=list)
    into_frontend_config_function: IntoFrontendConfigFunction | None = None
    """Function to parse plugin-scoped backend configuration (within the
    `tangram.toml`) into a frontend-safe configuration object.

    If not specified, the backend configuration dict is passed as-is."""
    services: list[tuple[Priority, ServiceAsyncFunc]] = field(
        default_factory=list, init=False
    )
    dist_name: str = field(init=False)
    """Name of the distribution (package) that provided this plugin, populated
    automatically during loading.
    """  # we do this so plugins can know their own package name if needed

    def register_service(
        self, priority: Priority = 0
    ) -> Callable[[ServiceFunc], ServiceFunc]:
        """Decorator to register a background service function.

        Services are long-running async functions that receive the BackendState
        and are started when the application launches.
        """

        def decorator(func: ServiceFunc) -> ServiceFunc:
            @functools.wraps(func)
            async def async_wrapper(backend_state: BackendState) -> None:
                if asyncio.iscoroutinefunction(func):
                    await func(backend_state)
                else:
                    await asyncio.to_thread(func, backend_state)

            self.services.append((priority, async_wrapper))
            return func

        return decorator


def scan_plugins() -> importlib.metadata.EntryPoints:
    return importlib.metadata.entry_points(group="tangram_core.plugins")


def load_plugin(
    entry_point: importlib.metadata.EntryPoint,
) -> Plugin | None:
    """Instantiates the plugin object defined in the entry point
    and injects the name of the distribution into it."""
    try:
        plugin_instance = entry_point.load()
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(
            f"failed to load plugin {entry_point.name}: {e}. {tb}"
            f"\n= help: does {entry_point.value} exist?"
        )
        return None
    if not isinstance(plugin_instance, Plugin):
        logger.error(f"entry point {entry_point.name} is not an instance of `Plugin`")
        return None
    if entry_point.dist is None:
        logger.error(f"could not determine distribution for plugin {entry_point.name}")
        return None
    # NOTE: we ignore `entry_point.name` for now and simply use the distribution's name
    # should we raise an error if they differ? not for now

    plugin_instance.dist_name = entry_point.dist.name
    return plugin_instance

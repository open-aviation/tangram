from __future__ import annotations

import asyncio
import functools
import importlib.metadata
import logging
import traceback
from collections.abc import Callable, Coroutine
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypeAlias

from fastapi import APIRouter

if TYPE_CHECKING:
    from pydantic import TypeAdapter
    from typer import Typer

    from .backend import BackendState

    ServiceAsyncFunc: TypeAlias = Callable[[BackendState], Coroutine[Any, Any, None]]
    ServiceFunc: TypeAlias = ServiceAsyncFunc | Callable[[BackendState], None]
    Priority: TypeAlias = int
    IntoFrontendConfigFunction: TypeAlias = Callable[[Any], Any]
    Lifespan: TypeAlias = Callable[
        [BackendState], AbstractAsyncContextManager[None, bool | None]
    ]

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
    config_class: type | None = None
    """The **backend** configuration class (dataclass, TypedDict or Pydantic model)
    for the plugin."""
    frontend_config_class: type | None = None
    """The **frontend** configuration class for the plugin. If set, it will be used to
    generate the frontend schema and validate settings updates.
    Fields should be annotated with [tangram_core.config.FrontendMutable][] if they
    are allowed to be modified from the frontend settings UI.
    """
    into_frontend_config_function: IntoFrontendConfigFunction | None = None
    """Function to transform the backend configuration into the frontend
    configuration. It receives the validated backend configuration object and
    should return an instance of `frontend_config_class`.
    Useful if the user wants to hide sensitive fields (e.g. API keys) from the frontend
    or dynamically compute certain fields.
    Required if `frontend_config_class` is set.
    """
    lifespan: Lifespan | None = None
    """Async context manager for plugin initialization and teardown."""
    services: list[tuple[Priority, ServiceAsyncFunc]] = field(
        default_factory=list, init=False
    )
    get_typer: Callable[[], Typer] | None = None
    """A function that returns the subcommands which will later be registered."""
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

    # HACK: so lru_cache on adapter works.
    # since we have mutable fields (routers, register_service, dist_name on init)
    # its difficult to make this class frozen,
    # so maybe we should implement __eq__ and __hash__ ourselves?
    __hash__ = object.__hash__

    @functools.lru_cache
    def adapter(self) -> TypeAdapter | None:
        """Returns a cached Pydantic TypeAdapter for the plugin's configuration class.

        Avoids expensive rebuilds on every validation request, such as those from the
        settings UI.
        """
        from pydantic import TypeAdapter

        if self.config_class:
            return TypeAdapter(self.config_class)
        return None

    @functools.lru_cache
    def frontend_adapter(self) -> TypeAdapter | None:
        """Returns a cached Pydantic TypeAdapter for the plugin's frontend
        configuration class."""
        from pydantic import TypeAdapter

        if self.frontend_config_class:
            return TypeAdapter(self.frontend_config_class)
        return None


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

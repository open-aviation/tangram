from __future__ import annotations

import asyncio
import functools
import importlib.metadata
import logging
import traceback
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, NewType, TypeAlias

from fastapi import APIRouter

if TYPE_CHECKING:
    from .backend import BackendState

    RouterFunc: TypeAlias = Callable[[], APIRouter]
    ServiceAsyncFunc: TypeAlias = Callable[[BackendState], Awaitable[None]]
    ServiceFunc: TypeAlias = ServiceAsyncFunc | Callable[[BackendState], None]
    Priority: TypeAlias = int

DistName = NewType("DistName", str)
logger = logging.getLogger(__name__)


@dataclass
class Plugin:
    frontend_path: str | None = None
    routers: list[APIRouter] = field(default_factory=list)
    services: list[tuple[Priority, ServiceAsyncFunc]] = field(
        default_factory=list, init=False
    )

    def register_service(
        self, priority: Priority = 0
    ) -> Callable[[ServiceFunc], ServiceFunc]:
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
) -> tuple[DistName, Plugin] | None:
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
    return DistName(entry_point.name), plugin_instance

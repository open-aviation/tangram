#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["typer"]
# ///
# NOTE: put all non-standard-library imports (including `tangram_core`) inside
# functions.

import asyncio
import logging
import logging.config
import os
import sys
from pathlib import Path
from typing import Annotated, TypeAlias

if sys.version_info >= (3, 11):
    from importlib.resources.abc import Traversable
else:
    from importlib.abc import Traversable

import typer
from rich.console import Console

app = typer.Typer(no_args_is_help=True, pretty_exceptions_enable=False)
logger = logging.getLogger(__name__)
stderr = Console(stderr=True)


def default_config_file() -> Path:
    # NOTE: we do not expose this in the core to discourage plugins from
    # manually parsing config files themselves.
    import platformdirs

    if (xdg_config := os.environ.get("XDG_CONFIG_HOME")) is not None:
        config_dir = Path(xdg_config) / "tangram"
    else:
        config_dir = Path(platformdirs.user_config_dir(appname="tangram"))
    if not config_dir.exists():
        config_dir.mkdir(parents=True, exist_ok=True)

    return Path(config_dir) / "tangram.toml"


PathTangramConfig: TypeAlias = Annotated[
    Path,
    typer.Option(
        help="Path to the tangram.toml config file.",
        envvar="TANGRAM_CONFIG",
        default_factory=default_config_file,
        exists=True,
        dir_okay=False,
    ),
]


@app.command()
def serve(
    config: PathTangramConfig,
) -> None:
    """Serves the core tangram frontend and backend services."""
    from .backend import get_log_config_dict, start_tasks
    from .config import Config

    cfg = Config.from_file(config)
    logging.config.dictConfig(get_log_config_dict(cfg))

    try:
        asyncio.run(start_tasks(cfg))
    except KeyboardInterrupt:
        logger.info("shutting down services.")


@app.command()
def list_plugins(
    config_path: PathTangramConfig | None = None,
    load_all: Annotated[
        bool, typer.Option("--all", "-a", help="Load all discovered plugins.")
    ] = False,
) -> None:
    """Lists discovered plugins and their components."""
    from rich.table import Table

    from .backend import resolve_frontend
    from .config import Config
    from .plugin import load_plugin, scan_plugins

    table = Table()
    table.add_column("plugin")
    table.add_column("status")
    table.add_column("frontend")
    table.add_column("routers")
    table.add_column("services")

    enabled_plugins: list[str] | None = None
    if config_path and config_path.is_file():
        config = Config.from_file(config_path)
        enabled_plugins = config.core.plugins

    for entry_point in scan_plugins():
        plugin_name = entry_point.name
        load_this_plugin = load_all or (
            enabled_plugins is not None and plugin_name in enabled_plugins
        )

        if not load_this_plugin:
            table.add_row(plugin_name, "available", "?", "?", "?")
            continue

        if (p := load_plugin(entry_point)) is None:
            status_str = "[red]load failed[/red]"
            table.add_row(plugin_name, status_str, "!", "!", "!")
            continue
        name, plugin = p
        status = (
            "enabled"
            if enabled_plugins and plugin_name in enabled_plugins
            else "loaded"
        )
        frontend_str = ""
        if plugin_path := plugin.frontend_path:
            if resolved_path := resolve_frontend(path=name, dist_name=plugin_name):
                size_kb = get_path_size(resolved_path) / 1024
                frontend_str = f"{size_kb:.1f} B"
            else:
                frontend_str = f"[yellow]({plugin_path} not found)[/yellow]"

        status_str = f"[green]{status}[/green]"
        router_prefixes = [func.prefix for func in plugin.routers]
        service_names = [func.__name__ for _, func in plugin.services]

        table.add_row(
            plugin_name,
            status_str,
            frontend_str,
            "\n".join(router_prefixes),
            "\n".join(service_names),
        )

    stderr.print(table)


def get_path_size(path: Path | Traversable) -> int:
    total_size = 0
    for item in path.iterdir():
        if item.is_file():
            with item.open("rb") as f:
                total_size += len(f.read())
        elif item.is_dir():
            total_size += get_path_size(item)
    return total_size


@app.command()
def develop() -> None:
    raise SystemExit


if __name__ == "__main__":
    app()

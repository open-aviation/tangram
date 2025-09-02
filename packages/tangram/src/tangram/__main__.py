import asyncio
import logging
from importlib.abc import Traversable
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from .backend import resolve_frontend, start_tasks
from .config import Config
from .plugin import load_plugin, scan_plugins

app = typer.Typer(no_args_is_help=True)
logger = logging.getLogger(__name__)
stderr = Console(stderr=True)


@app.command()
def serve(
    config: Annotated[Path, typer.Option(help="Path to the tangram.toml config file.")],
) -> None:
    """Serves the core tangram frontend and backend services."""
    if not config.is_file():
        logger.error(f"config file not found: {config}")
        raise typer.Exit()

    try:
        asyncio.run(start_tasks(Config.from_file(config)))
    except KeyboardInterrupt:
        logger.info("shutting down services.")


@app.command(name="list-plugins")
def list_plugins(
    config_path: Annotated[
        Path | None,
        typer.Option("--config", help="Path to the tangram.toml config file."),
    ] = None,
    all_plugins: Annotated[
        bool, typer.Option("--all", help="Load all discovered plugins.")
    ] = False,
) -> None:
    """Lists discovered plugins and their components."""
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
        load_this_plugin = all_plugins or (
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

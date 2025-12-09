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
import re
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any, Generator, TypeAlias

if sys.version_info >= (3, 11):
    from importlib.resources.abc import Traversable
else:
    from importlib.abc import Traversable

import typer
from rich.console import Console

app = typer.Typer(no_args_is_help=True, pretty_exceptions_enable=False)
logger = logging.getLogger(__name__)
stderr = Console(stderr=True)
stdout = Console(stderr=False)


def print_error(v: Any) -> None:
    stdout.print(f"[bold red]error[/bold red]: {v}")


def print_success(v: Any) -> None:
    stdout.print(f"[bold green]success[/bold green]: {v}")


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
        version = dist.version if (dist := entry_point.dist) is not None else "?"
        plugin_str = f"{plugin_name}=={version}"
        load_this_plugin = load_all or (
            enabled_plugins is not None and plugin_name in enabled_plugins
        )

        if not load_this_plugin:
            table.add_row(plugin_str, "[cyan]available[/cyan]", "?", "?", "?")
            continue

        if (plugin := load_plugin(entry_point)) is None:
            status_str = "[red]load failed[/red]"
            table.add_row(plugin_str, status_str, "!", "!", "!")
            continue
        status = (
            "enabled"
            if enabled_plugins and plugin_name in enabled_plugins
            else "loaded"
        )
        if plugin.frontend_path is None:
            frontend_str = ""
        elif resolved_path := resolve_frontend(plugin):
            size_kb = get_path_size(resolved_path) / 1024
            frontend_str = f"{size_kb:.1f} B"
        else:
            frontend_str = f"[yellow]({plugin.frontend_path} not found)[/yellow]"

        status_str = f"[green]{status}[/green]"
        router_prefixes = [func.prefix for func in plugin.routers]
        service_names = [func.__name__ for _, func in plugin.services]

        table.add_row(
            plugin_str,
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
def init() -> None:
    raise NotImplementedError


#
# developer utilities
#


def get_package_paths(
    extra_paths: list[Path] | None, all_plugins: bool
) -> Generator[tuple[str, Path], None, None]:
    if all_plugins:
        from .backend import get_distribution_path
        from .plugin import scan_plugins

        yield "core", get_distribution_path("tangram_core")

        for ep in scan_plugins():
            name = ep.dist.name if ep.dist else ep.name
            yield name, get_distribution_path(name)
    if extra_paths:
        for path in extra_paths:
            yield "(unknown name)", path


@app.command()
def check_plugin(
    extra_paths: Annotated[
        list[Path] | None,
        typer.Argument(help="Extra paths to plugin directories.", exists=True),
    ] = None,
    all: bool = False,
) -> None:
    """Verifies that plugin `devDependencies` match those defined in the core."""
    import json

    from .backend import get_distribution_path

    if extra_paths is None and not all:
        all = True

    core_path = get_distribution_path("tangram_core")

    core_pkg_json = core_path / "package.json"
    core_package_json = json.loads(core_pkg_json.read_text())
    core_deps = core_package_json.get("dependencies", {}) | core_package_json.get(
        "devDependencies", {}
    )

    has_error = False
    for dist_name, path in get_package_paths(extra_paths, all):
        pkg_json = path / "package.json"
        if not pkg_json.exists():
            continue  # not all plugins have frontends, so we just skip silently
        stderr.print(f"checking '{dist_name}' at {path}")
        plugin_deps = json.loads(pkg_json.read_text()).get("devDependencies", {})
        for dep, version in plugin_deps.items():
            if dep in core_deps and core_deps[dep] != version:
                print_error(
                    f"expected '{dep}@{core_deps[dep]}' but found '{dep}@{version}' "
                    f"in {path.name}"
                )
                has_error = True

    if has_error:
        raise typer.Exit(1)
    print_success("all plugin dependencies verified")


RE_TOML = r'(^version\s*=\s*)"[^"]+"'
RE_JSON = r'("version"\s*:\s*)"[^"]+"'


def set_version_in_file(path: Path, regex: str, version: str) -> bool:
    if not path.exists():
        return False
    content = path.read_text()
    new_content = re.sub(
        regex,
        f'\\1"{version}"',
        content,
        flags=re.MULTILINE,
    )
    if content != new_content:
        path.write_text(new_content)
        return True
    return False


def run_command(cmd: list[str], cwd: Path) -> None:
    try:
        stderr.print(f"running '{' '.join(cmd)}' in {cwd}")
        subprocess.run(
            cmd, cwd=cwd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
        )
    except subprocess.CalledProcessError as e:
        print_error(f"command failed in {cwd}: {' '.join(cmd)}\n{e.stderr.decode()}")


@app.command()
def set_plugin_version(
    version: str,
    extra_path: Annotated[
        list[Path] | None,
        typer.Argument(help="Paths to plugins to update.", exists=True),
    ] = None,
    all: bool = False,
    update_lock: bool = True,
) -> None:
    """Updates version in pyproject.toml, package.json and Cargo.toml."""
    # we allow bumping versions without bumping core.
    cwd = Path.cwd()
    is_in_workspace = (
        cwd / "pnpm-workspace.yaml"
    ).exists() or "[workspace.package]" in (cwd / "Cargo.toml").read_text()

    if not extra_path and not all:
        print_error(
            "either --all must be specified or at least one extra path must be given"
        )
        raise typer.Exit(1)

    update_root_uv_lock = False
    for dist_name, path in get_package_paths(extra_path, all):
        updated_py = False
        updated_rs = False

        pyproject_toml = path / "pyproject.toml"
        if set_version_in_file(pyproject_toml, RE_TOML, version):
            print_success(f"updated '{dist_name}' at {pyproject_toml}")
            updated_py = True

        pkg_json = path / "package.json"
        if set_version_in_file(pkg_json, RE_JSON, version):
            print_success(f"updated '{dist_name}' at {pkg_json}")

        cargo_toml = path / "Cargo.toml"
        if not cargo_toml.exists() and (path / "rust" / "Cargo.toml").exists():
            cargo_toml = path / "rust" / "Cargo.toml"
        if cargo_toml.exists():
            content = cargo_toml.read_text()
            if "version.workspace = true" not in content:
                if set_version_in_file(cargo_toml, RE_TOML, version):
                    print_success(f"updated '{dist_name}' at {cargo_toml}")
                    updated_rs = True

        if update_lock:
            if is_in_workspace:  # defer
                update_root_uv_lock = True
                continue
            if updated_py:
                run_command(["uv", "lock"], path)
            if updated_rs:
                run_command(["cargo", "check"], cargo_toml.parent)

    if is_in_workspace:
        if update_root_uv_lock:
            run_command(["uv", "lock"], cwd)

        if not all:
            return
        updated_rs_ws = False
        root_cargo = cwd / "Cargo.toml"
        if root_cargo.exists():
            if set_version_in_file(root_cargo, RE_TOML, version):
                print_success(f"updated workspace '{root_cargo}'")
                updated_rs_ws = True
        if update_lock:
            if updated_rs_ws:
                run_command(["cargo", "check", "--workspace"], cwd)


if __name__ == "__main__":
    app()

"""A history management CLI that operates safely regardless of whether the
`tangram serve` backend is running. Operations repsect the single-writer
principle of Delta Lake when ingestion is active, or function when offline.

When *online*, the CLI acts as a remote control, sending serialised commands via
Redis, with the service orchestrating locks (pausing ingestion/maintenance).
When *offline*, the CLI **assumes exclusive access** and operates directly on
the file system via PyO3 bindings.
"""

import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum, auto
from pathlib import Path
from typing import Annotated, Any, Protocol, TypeAlias, TypeVar, assert_never

import orjson
import redis
import typer
from rich.console import Console
from rich.table import Table
from tangram_core.config import Config, default_config_file

from .config import HistoryConfig

app = typer.Typer(name="history", help="Manage historical data storage.")
console = Console()

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
ForceOffline: TypeAlias = Annotated[
    bool,
    typer.Option(
        "--force-offline",
        help="Force offline operation, bypassing the tangram service even if online.",
    ),
]


def print_error(v: Any) -> None:
    console.print(f"[bold red]error[/bold red]: {v}")


def print_note(v: Any) -> None:
    console.print(f"[bold cyan]note[/bold cyan]: {v}")


def print_warning(v: Any) -> None:
    console.print(f"[bold yellow]warning[/bold yellow]: {v}")


@dataclass(frozen=True)
class _CfgResult:
    config: Config
    history_config: HistoryConfig


def parse_config(config_path: Path) -> _CfgResult:
    from pydantic import TypeAdapter

    if not config_path.exists():
        print_error(f"config file not found: {config_path}")
        raise typer.Exit(1)

    config = Config.from_file(config_path)
    plugin_config = config.plugins.get("tangram_history", {})
    return _CfgResult(
        config=config,
        history_config=TypeAdapter(HistoryConfig).validate_python(plugin_config),
    )


class HistoryStatus(Enum):
    HAS_SUBSCRIBERS = auto()
    NO_SUBSCRIBERS = auto()
    REDIS_OFFLINE = auto()

    def to_message(self) -> str:
        if self == HistoryStatus.HAS_SUBSCRIBERS:
            return "service is online and has subscribers"
        if self == HistoryStatus.NO_SUBSCRIBERS:
            return "no subscribers on history control channel"
        if self == HistoryStatus.REDIS_OFFLINE:
            return "unable to connect to redis"
        assert_never(self)


def get_service_status(redis_url: str, control_channel: str) -> HistoryStatus:
    try:
        r = redis.from_url(redis_url)  # type: ignore
        response: list[tuple[str, int]] = r.pubsub_numsub(control_channel)  # type: ignore
        if not response:
            return HistoryStatus.NO_SUBSCRIBERS
        return (
            HistoryStatus.HAS_SUBSCRIBERS
            if response[0][1] > 0  # type: ignore
            else HistoryStatus.NO_SUBSCRIBERS
        )
    except redis.ConnectionError:
        return HistoryStatus.REDIS_OFFLINE


class SupportsSerde(Protocol):
    @staticmethod
    def from_json_bytes(data: bytes) -> Any: ...
    def to_json_bytes(self) -> bytes: ...


T = TypeVar("T", bound=SupportsSerde)


def send_command(
    config_result: _CfgResult,
    sender_id: str,
    message_bytes: bytes,
    response_type: type[T],
    *,
    timeout: int = 10,
) -> T | None:
    redis_url = config_result.config.core.redis_url
    control_channel = config_result.history_config.control_channel
    response_channel = f"{control_channel}:response:{sender_id}"

    try:
        r = redis.from_url(redis_url)  # type: ignore
        p = r.pubsub()
        p.subscribe(response_channel)
        p.get_message(timeout=2.0)  # subscription confirmation

        r.publish(control_channel, message_bytes)

        response_message = p.get_message(timeout=timeout)
        p.unsubscribe()
        r.close()

        if response_message and response_message.get("type") == "message":
            return response_type.from_json_bytes(response_message["data"])
        return None
    except redis.ConnectionError:
        return None


def format_schema(schema_str: str, prefix: str = "") -> str:
    schema = orjson.loads(schema_str)

    lines = []

    fields = schema.get("fields")
    if not fields:
        return str(schema)

    for i, field in enumerate(fields):
        name = field.get("name", "unknown")
        type_info = field.get("type")
        nullable = field.get("nullable", True)

        is_last = i == len(fields) - 1
        connector = "└─" if is_last else "├─"

        type_str = ""
        if isinstance(type_info, str):
            type_str = type_info
        elif isinstance(type_info, dict):
            # TODO enhance this
            type_str = type_info.get("type", "complex")
            if type_str == "struct":
                type_str = "struct<...>"
            elif type_str == "array":
                type_str = "array<...>"
            elif type_str == "map":
                type_str = "map<...>"

        metadata = field.get("metadata", {})
        meta_str = f" (metadata: {metadata})" if metadata else ""
        nullable_str = "[dim] (nullable)[/dim]" if nullable else ""
        lines.append(
            f"{prefix}{connector} [bold cyan]{name}[/bold cyan]: {type_str}"
            f"{nullable_str}{meta_str}"
        )

        # recursively format struct fields is tricky with JSON string passed down
        # simpler to just show it as struct<...> for now or serialize subsection

    return "\n".join(lines)


@app.command()
def ls(
    config: PathTangramConfig,
    show_schema: bool = True,
    force_offline: ForceOffline = False,
) -> None:
    """List all history tables found in the configured storage directory."""
    from . import _history

    cfg = parse_config(config)
    status = get_service_status(
        cfg.config.core.redis_url, cfg.history_config.control_channel
    )

    tables: list[_history.TableInfo] = []
    if status == HistoryStatus.HAS_SUBSCRIBERS:
        sender_id = str(uuid.uuid4())
        msg = _history.ControlMessage.ListTables(sender_id).to_json_bytes()
        if response := send_command(
            cfg, sender_id, msg, _history.ControlResponse, timeout=2
        ):
            if isinstance(response, _history.ControlResponse.TableList):
                tables = response.tables
            elif isinstance(response, _history.ControlResponse.CommandFailed):
                print_error(f"list tables failed: {response.error}")
            else:
                print_error(f"unexpected response: {response}")
        else:
            print_warning("service appeared online but did not respond, trying offline")
            status = HistoryStatus.REDIS_OFFLINE

    if force_offline or status != HistoryStatus.HAS_SUBSCRIBERS:
        base_path = str(cfg.history_config.base_path)
        if not force_offline:
            print_note(f"{status.to_message()}, listing tables in {base_path}")

        tables = _history.list_tables_offline(base_path)

    for t in tables:
        console.print(f"{t.name} @ {t.uri} (version {t.version})")
        if show_schema:
            console.print(format_schema(t.schema))


yesterday = (datetime.now(tz=timezone.utc) - timedelta(days=1)).isoformat(
    timespec="seconds"
)


@app.command()
def rm(
    table_name: Annotated[str, typer.Argument(help="Name of the history table.")],
    predicate: Annotated[
        str,
        typer.Argument(
            help=f"""DataFusion SQL condition for rows to delete. "
Examples: "timestamp < \'{yesterday}\'", "df == 17", "altitude > 54000 OR altitude < 0".
See: <https://datafusion.apache.org/user-guide/sql/index.html>"""
        ),
    ],
    config: PathTangramConfig,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Perform a dry run only (skip execution)."),
    ] = False,
    force_offline: ForceOffline = False,
) -> None:
    """Delete rows from a history table based on a condition.

    Queries the count and preview using datafusion `SessionContext`.
    If the tangram service is online, the service acquires a write lock and
    acquires semaphores for optimisation/vaccuming before execution.
    """
    from . import _history

    cfg = parse_config(config)
    status = get_service_status(
        cfg.config.core.redis_url, cfg.history_config.control_channel
    )

    with console.status("analyzing delete impact..."):
        if not force_offline and status == HistoryStatus.HAS_SUBSCRIBERS:
            sender_id = str(uuid.uuid4())
            msg = _history.ControlMessage.DeleteRows(
                sender_id, table_name, predicate, dry_run=True
            ).to_json_bytes()
            response = send_command(cfg, sender_id, msg, _history.ControlResponse)
            if not response:
                print_error("failed to get response from history service")
                raise typer.Exit(1)
        else:
            if not force_offline:
                print_note(f"{status.to_message()}, assuming exclusive access of table")
            response = _history.delete_rows_offline(
                base_path=str(cfg.history_config.base_path),
                table_name=table_name,
                predicate=predicate,
                dry_run=True,
            )

    if isinstance(response, _history.ControlResponse.CommandFailed):
        print_error(f"analysis failed: {response.error}")
        raise typer.Exit(1)

    if not isinstance(response, _history.ControlResponse.DeleteOutput):
        print_error(f"unexpected response: {response}")
        raise typer.Exit(1)

    count = response.affected_rows

    if count == 0:
        console.print("no rows matched the predicate.")
        return
    print_note(f"predicate matched [bold]{count}[/bold] rows")
    if preview_json := response.preview:
        rows = orjson.loads(preview_json)
        if rows:
            console.print("preview of rows to be deleted:")
            table_preview = Table(show_header=True)
            for key in rows[0].keys():
                table_preview.add_column(key)
            for row in rows:
                table_preview.add_row(*[str(row.get(k)) for k in rows[0].keys()])
            console.print(table_preview)

    if dry_run:
        return

    if not typer.confirm("are you sure?"):
        raise typer.Abort()

    time_start = time.perf_counter()
    with console.status("deleting..."):
        if not force_offline and status == HistoryStatus.HAS_SUBSCRIBERS:
            sender_id = str(uuid.uuid4())
            msg = _history.ControlMessage.DeleteRows(
                sender_id, table_name, predicate, dry_run=False
            ).to_json_bytes()
            exec_response = send_command(
                cfg, sender_id, msg, _history.ControlResponse, timeout=300
            )
            if not exec_response:
                print_error("timed out waiting for delete confirmation.")
                raise typer.Exit(1)
        else:
            exec_response = _history.delete_rows_offline(
                base_path=str(cfg.history_config.base_path),
                table_name=table_name,
                predicate=predicate,
                dry_run=False,
            )

    if isinstance(exec_response, _history.ControlResponse.CommandFailed):
        print_error(f"delete failed: {exec_response.error}")
        raise typer.Exit(1)
    if not isinstance(exec_response, _history.ControlResponse.DeleteOutput):
        print_error(f"unexpected response: {exec_response}")
        raise typer.Exit(1)
    deleted = exec_response.affected_rows
    console.print(
        f"[bold green]success:[/bold green] deleted {deleted} rows from '{table_name}'"
        f" in [bold]{time.perf_counter() - time_start:.2f} seconds[/bold]."
    )

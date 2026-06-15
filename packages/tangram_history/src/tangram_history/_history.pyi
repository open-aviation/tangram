from collections.abc import Sequence
from typing import Any, Final, final

class ControlMessage:
    @staticmethod
    def from_json_bytes(data: bytes) -> ControlMessage: ...
    def to_json_bytes(self, /) -> bytes: ...
    @final
    class DeleteRows(ControlMessage):
        """
        Deletes rows in a table using with a specified predicate.
        
        **WARNING**:
        
        The current implementation uses raw string formatting to query row counts and previews, with
        the following SQL operations disallowed
        
        - [DDL](https://docs.rs/datafusion/latest/datafusion/logical_expr/enum.DdlStatement.html)
        - [DML](https://docs.rs/datafusion/latest/datafusion/logical_expr/struct.DmlStatement.html)
        - [Statements](https://docs.rs/datafusion/latest/datafusion/logical_expr/enum.Statement.html)
        
        It may be prone to SQL injection.
        """
        __match_args__: Final = ("sender_id", "table_name", "predicate", "dry_run")
        def __new__(cls, /, sender_id: str, table_name: str, predicate: str, dry_run: bool) -> ControlMessage.DeleteRows: ...
        @property
        def dry_run(self, /) -> bool: ...
        @property
        def predicate(self, /) -> str:
            """
            The predicate expression, which must have Boolean type
            
            See: <https://docs.rs/datafusion/latest/datafusion/logical_expr/enum.Expr.html>
            """
        @property
        def sender_id(self, /) -> str: ...
        @property
        def table_name(self, /) -> str: ...
    @final
    class ListTables(ControlMessage):
        __match_args__: Final = ("sender_id",)
        def __new__(cls, /, sender_id: str) -> ControlMessage.ListTables: ...
        @property
        def sender_id(self, /) -> str: ...
    @final
    class Ping(ControlMessage):
        __match_args__: Final = ("sender",)
        def __new__(cls, /, sender: str) -> ControlMessage.Ping: ...
        @property
        def sender(self, /) -> str: ...
    @final
    class RegisterTable(ControlMessage):
        __match_args__: Final = ("_0",)
        @property
        def _0(self, /) -> RegisterTable: ...
        def __getitem__(self, /, key: int) -> Any: ...
        def __len__(self, /) -> int: ...
        def __new__(cls, /, _0: RegisterTable) -> ControlMessage.RegisterTable: ...

class ControlResponse:
    @staticmethod
    def from_json_bytes(data: bytes) -> ControlResponse: ...
    def to_json_bytes(self, /) -> bytes: ...
    @final
    class CommandFailed(ControlResponse):
        """
        Returned when a control command fails; contains the error message.
        """
        __match_args__: Final = ("request_id", "error")
        def __new__(cls, /, request_id: str, error: str) -> ControlResponse.CommandFailed: ...
        @property
        def error(self, /) -> str: ...
        @property
        def request_id(self, /) -> str: ...
    @final
    class DeleteOutput(ControlResponse):
        """
        Successful delete response with affected row count and optional preview.
        """
        __match_args__: Final = ("request_id", "dry_run", "affected_rows", "preview")
        def __new__(cls, /, request_id: str, dry_run: bool, affected_rows: int, preview: str |None) -> ControlResponse.DeleteOutput: ...
        @property
        def affected_rows(self, /) -> int: ...
        @property
        def dry_run(self, /) -> bool: ...
        @property
        def preview(self, /) -> str |None:
            """
            JSON string of RecordBatch
            """
        @property
        def request_id(self, /) -> str: ...
    @final
    class Pong(ControlResponse):
        __match_args__: Final = ("sender",)
        def __new__(cls, /, sender: str) -> ControlResponse.Pong: ...
        @property
        def sender(self, /) -> str: ...
    @final
    class RegistrationFailed(ControlResponse):
        __match_args__: Final = ("request_id", "table_name", "error")
        def __new__(cls, /, request_id: str, table_name: str, error: str) -> ControlResponse.RegistrationFailed: ...
        @property
        def error(self, /) -> str: ...
        @property
        def request_id(self, /) -> str: ...
        @property
        def table_name(self, /) -> str: ...
    @final
    class TableList(ControlResponse):
        __match_args__: Final = ("request_id", "tables")
        def __new__(cls, /, request_id: str, tables: Sequence[TableInfo]) -> ControlResponse.TableList: ...
        @property
        def request_id(self, /) -> str: ...
        @property
        def tables(self, /) -> list[TableInfo]: ...
    @final
    class TableRegistered(ControlResponse):
        __match_args__: Final = ("request_id", "table_name", "table_uri")
        def __new__(cls, /, request_id: str, table_name: str, table_uri: str) -> ControlResponse.TableRegistered: ...
        @property
        def request_id(self, /) -> str: ...
        @property
        def table_name(self, /) -> str: ...
        @property
        def table_uri(self, /) -> str: ...

@final
class HistoryConfig:
    def __new__(cls, /, redis_url: str, control_channel: str, base_path: str, redis_read_count: int, redis_read_block_ms: int) -> HistoryConfig: ...
    @property
    def base_path(self, /) -> str: ...
    @base_path.setter
    def base_path(self, /, value: str) -> None: ...
    @property
    def control_channel(self, /) -> str: ...
    @control_channel.setter
    def control_channel(self, /, value: str) -> None: ...
    @property
    def redis_read_block_ms(self, /) -> int: ...
    @redis_read_block_ms.setter
    def redis_read_block_ms(self, /, value: int) -> None: ...
    @property
    def redis_read_count(self, /) -> int: ...
    @redis_read_count.setter
    def redis_read_count(self, /, value: int) -> None: ...
    @property
    def redis_url(self, /) -> str: ...
    @redis_url.setter
    def redis_url(self, /, value: str) -> None: ...

@final
class RegisterTable:
    @property
    def checkpoint_interval(self, /) -> int: ...
    @checkpoint_interval.setter
    def checkpoint_interval(self, /, value: int) -> None: ...
    @staticmethod
    def from_json_bytes(data: bytes) -> RegisterTable: ...
    @property
    def optimize_interval_secs(self, /) -> int: ...
    @optimize_interval_secs.setter
    def optimize_interval_secs(self, /, value: int) -> None: ...
    @property
    def optimize_target_file_size(self, /) -> int: ...
    @optimize_target_file_size.setter
    def optimize_target_file_size(self, /, value: int) -> None: ...
    @property
    def partition_columns(self, /) -> list[str]: ...
    @partition_columns.setter
    def partition_columns(self, /, value: Sequence[str]) -> None: ...
    @property
    def schema(self, /) -> str:
        """
        Base64 encoded arrow ipc schema format
        """
    @schema.setter
    def schema(self, /, value: str) -> None:
        """
        Base64 encoded arrow ipc schema format
        """
    @property
    def sender_id(self, /) -> str: ...
    @sender_id.setter
    def sender_id(self, /, value: str) -> None: ...
    @property
    def table_name(self, /) -> str: ...
    @table_name.setter
    def table_name(self, /, value: str) -> None: ...
    def to_json_bytes(self, /) -> bytes: ...
    @property
    def vacuum_interval_secs(self, /) -> int: ...
    @vacuum_interval_secs.setter
    def vacuum_interval_secs(self, /, value: int) -> None: ...
    @property
    def vacuum_retention_period_secs(self, /) -> int |None: ...
    @vacuum_retention_period_secs.setter
    def vacuum_retention_period_secs(self, /, value: int |None) -> None: ...

@final
class TableInfo:
    @staticmethod
    def from_json_bytes(data: bytes) -> TableInfo: ...
    @property
    def name(self, /) -> str: ...
    @name.setter
    def name(self, /, value: str) -> None: ...
    @property
    def schema(self, /) -> str:
        """
        Serialised JSON schema
        """
    @schema.setter
    def schema(self, /, value: str) -> None:
        """
        Serialised JSON schema
        """
    def to_json_bytes(self, /) -> bytes: ...
    @property
    def uri(self, /) -> str: ...
    @uri.setter
    def uri(self, /, value: str) -> None: ...
    @property
    def version(self, /) -> int: ...
    @version.setter
    def version(self, /, value: int) -> None: ...

def delete_rows_offline(base_path: str, table_name: str, predicate: str, dry_run: bool) -> ControlResponse:
    """
    Delete rows from a history table stored on disk.
    
    :raises OSError: if the table does not exist or filesystem access fails.
    :return: ControlResponse.DeleteOutput on success, ControlResponse.CommandFailed on failure.
    """

def init_tracing_stderr(filter_str: str) -> None: ...

def list_tables_offline(base_path: str) -> list[TableInfo]:
    """
    List history tables by inspecting the on-disk Delta Lake directory.
    
    :raises OSError: if the table does not exist or filesystem access fails.
    """

def run_history(config: HistoryConfig) -> Any:
    """
    Start the history ingest service.
    
    :raises RuntimeError: if the service fails to start or crashes.
    """

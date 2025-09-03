import asyncio
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import AsyncGenerator, Generator

import httpx
import pytest

# TODO(abr): share fixtures across packages with pytest plugins


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@dataclass(frozen=True)
class ServerConfig:
    config_path: Path
    server_url: str


@pytest.fixture(scope="session")
def server_config() -> Generator[ServerConfig, None, None]:
    host = "127.0.0.1"
    # TODO: find free port
    server_port = 2346
    channel_port = 8001

    config_content = f"""
[core]
redis_url = "redis://localhost:6379"
plugins = []

[server]
host = "{host}"
port = {server_port}

[channel]
host = "{host}"
port = {channel_port}
jwt_secret = "test-secret"
"""

    with TemporaryDirectory() as config_dir:
        config_path = Path(config_dir) / "tangram.toml"
        config_path.write_text(config_content)

        yield ServerConfig(
            config_path=config_path, server_url=f"http://{host}:{server_port}"
        )


@pytest.fixture(scope="session")
async def live_server(server_config: ServerConfig) -> AsyncGenerator[str, None]:
    """Starts the tangram server as a subprocess for the test session."""

    proc = await asyncio.create_subprocess_exec(
        "tangram",
        "serve",
        f"--config={server_config.config_path}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    max_wait_seconds = 30
    poll_interval_seconds = 0.1
    async with httpx.AsyncClient() as client:
        for _ in range(int(max_wait_seconds / poll_interval_seconds)):
            try:
                response = await client.get(
                    server_config.server_url, timeout=poll_interval_seconds
                )
                if response.status_code == 200:
                    await asyncio.sleep(1)  # give it a moment to settle
                    break
            except (httpx.ConnectError, httpx.TimeoutException):
                await asyncio.sleep(poll_interval_seconds)
        else:
            proc.terminate()
            stdout, stderr = await proc.communicate()
            pytest.fail(
                f"server did not start within {max_wait_seconds} seconds.\n"
                f"{stdout.decode()=}\n{stderr.decode()=}"
            )

    yield server_config.server_url

    proc.terminate()
    await proc.wait()


@pytest.fixture(scope="session")
def server_url(live_server: str) -> str:
    """Provides the URL of the live server started by the live_server fixture."""
    return live_server


@pytest.fixture(scope="session")
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient() as client:
        yield client


@pytest.mark.anyio
async def test_static(client: httpx.AsyncClient, server_url: str) -> None:
    response = await client.get(f"{server_url}")
    response.raise_for_status()
    assert response.content.startswith(b"<!DOCTYPE html>")


@pytest.mark.anyio
async def test_api(client: httpx.AsyncClient, server_url: str) -> None:
    response = await client.get(f"{server_url}/manifest.json")
    response.raise_for_status()
    manifest = response.json()
    assert "plugins" in manifest

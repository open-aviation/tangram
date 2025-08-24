import os
from pathlib import Path
from typing import AsyncGenerator

import httpx
import pytest
from tangram.config import TangramConfig

# TODO(abr): share fixtures across packages with pytest plugins


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session", autouse=True)
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient() as client:
        yield client


@pytest.fixture(scope="session")
def server_url() -> str:
    config_path_str = os.environ.get("TANGRAM_CONFIG_PATH")
    assert config_path_str is not None

    config_path = Path(config_path_str)
    assert config_path.is_file()

    config = TangramConfig.from_file(config_path)
    return f"http://{config.server.host}:{config.server.port}"


@pytest.mark.anyio
async def test_static(
    client: httpx.AsyncClient, server_url: str
) -> None:
    response = await client.get(f"{server_url}")
    response.raise_for_status()
    assert response.content.startswith(b"<!DOCTYPE html>")

@pytest.mark.anyio
async def test_api(
    client: httpx.AsyncClient, server_url: str
) -> None:
    response = await client.get(f"{server_url}/manifest.json")
    response.raise_for_status()
    manifest = response.json()
    assert manifest.get("plugins") is not None

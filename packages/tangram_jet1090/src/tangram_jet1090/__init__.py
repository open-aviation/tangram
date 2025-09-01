from dataclasses import dataclass

import tangram
from fastapi import APIRouter
from pydantic import TypeAdapter

from .common import rs1090

jet1090_restful_client = rs1090.Rs1090Client()

router = APIRouter()


@router.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.df in [17, 18, 20, 21]]


plugin = tangram.Plugin(frontend_path="dist-frontend", routers=[router])


@dataclass(frozen=True)
class PlanesConfig:
    jet1090_channel: str = "jet1090"
    history_expire: int = 20


@plugin.register_service()
async def run_planes(config: tangram.Config) -> None:
    from . import _planes

    config_planes = TypeAdapter(PlanesConfig).validate_python(
        config.plugins.get("tangram_jet1090", {})
    )

    _planes.init_logging("debug")

    rust_config = _planes.PlanesConfig(
        redis_url=config.core.redis_url,
        jet1090_channel=config_planes.jet1090_channel,
        history_expire=config_planes.history_expire,
    )
    await _planes.run_planes(rust_config)

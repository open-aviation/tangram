from fastapi import APIRouter, FastAPI
from tangram.config import TangramConfig

from .common import rs1090

jet1090_restful_client = rs1090.Rs1090Client()

router = APIRouter()


def register_plugin(app: FastAPI) -> None:
    """Register this plugin with the main FastAPI application."""
    app.include_router(router)


@router.get("/data/{icao24}")
async def data(icao24: str) -> list[rs1090.Jet1090Data]:
    records = await jet1090_restful_client.icao24_track(icao24) or []
    return [r for r in records if r.df in [17, 18, 20, 21]]


async def run_planes(config: TangramConfig) -> None:
    from . import _planes
    # TODO: Get these from a plugin-specific config section
    jet1090_channel = "jet1090"
    history_expire = 20

    _planes.init_logging("debug")

    rust_config = _planes.PlanesConfig(
        redis_url=config.core.redis_url,
        jet1090_channel=jet1090_channel,
        history_expire=history_expire,
    )
    await _planes.run_planes(rust_config)

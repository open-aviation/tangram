import asyncio

import numpy as np
import polars as pl
import tangram_core
from tangram_core.config import CoreConfig
from tangram_explore import ScatterLayer, Session


async def main() -> None:
    async with tangram_core.Runtime(
        config=tangram_core.Config(core=CoreConfig(plugins=["tangram_explore"]))
    ) as runtime:
        session = Session(runtime.state)

        x = np.linspace(-13, 13, 100)
        await session.push(
            ScatterLayer(
                pl.DataFrame({"longitude": x, "latitude": x}),
                fill_color="#027ec7",
                label="NE-SW",
            ),
        )
        await session.push(
            ScatterLayer(
                pl.DataFrame({"longitude": x, "latitude": -x}),
                fill_color="#be4d5e",
                label="NW-SE",
            )
        )
        await runtime.wait()


if __name__ == "__main__":
    asyncio.run(main())

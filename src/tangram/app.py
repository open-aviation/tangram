import logging
from datetime import datetime
from typing import Dict, Any

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
log = logging.getLogger(__name__)

app = FastAPI()
app.mount('/static', StaticFiles(directory='static'), name='static')
templates = Jinja2Templates(directory='templates')
start_time = datetime.now()


def get_uptime_seconds() -> float:
    return (datetime.now() - start_time).total_seconds()


@app.get('/uptime')
async def uptime():
    return {"uptime": get_uptime_seconds()}


@app.get('/')
async def home(request: Request, history: int = 0):
    log.info('index, history: %s', history)
    context = dict(history=history, form_database=None, form_threshold=None, uptime=get_uptime_seconds())
    return templates.TemplateResponse(request=request, name='index.html', context=context)


@app.get("/turb.geojson")
async def turbulence() -> Dict[str, Any]:
    return {}


@app.get("/planes.geojson")
async def fetch_planes_Geojson() -> Dict[str, Any]:
    return {}

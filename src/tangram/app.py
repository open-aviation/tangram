import logging
import uuid
import json
from datetime import datetime
from typing import Dict, Any, List

from broadcaster import Broadcast
from fastapi import FastAPI, Request, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from pydantic import BaseModel
from fastapi.concurrency import run_until_first_complete

from tangram.plugins import rs1090_source


# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(filename)s:%(lineno)s - %(message)s')
log = logging.getLogger('tangram')

# broadcast = Broadcast("redis://127.0.0.1:6379")
broadcast = Broadcast('memory://')


async def shutdown(*args, **kwargs):
    """debugging"""
    log.info('%s\n\n\n\n', '=' * 40)


async def start_publish_job(*args, **kwargs):
    log.info('<PR> start task')
    await rs1090_source.publish_runner.start_task()
    log.info('<PR> task created: %s', rs1090_source.publish_runner.task)


async def shutdown_publish_job() -> None:
    log.info('shuting down publish runner task: %s', rs1090_source.publish_runner.task)
    if rs1090_source.publish_runner.task is None:
        log.warning('publish runner task is None')
        return

    if rs1090_source.publish_runner.task.done():
        rs1090_source.publish_runner.task.result()
    else:
        rs1090_source.publish_runner.task.cancel()
    log.info('shutdown - publish job done')


templates = Jinja2Templates(directory='templates')
app = FastAPI(
    on_startup=[
        broadcast.connect,
        start_publish_job,
        # rs1090_source.start_publish_job,
    ],
    on_shutdown=[
        broadcast.disconnect,
        shutdown_publish_job,
        # rs1090_source.shutdown_publish_job,
        shutdown,
    ],
)
app.mount('/static', StaticFiles(directory='static'), name='static')
app.mount('/plugins/rs1090', rs1090_source.rs1090_app)

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
async def fetch_planes_geojson() -> Dict[str, Any]:
    return {}


class Hub:

    def __init__(self) -> None:
        self._channel_clients: dict[str, set[str]] = {}

    def join(self, client_id: str, channel: str):
        if client_id not in self._channel_clients:
            self._channel_clients[channel] = set()
        self._channel_clients[channel].add(client_id)

    def channel_clients(self):
        return self._channel_clients

    def channels(self) -> List[str]:
        return list(self.channel_clients().keys())

    def clients(self) -> List[str]:
        return list(broadcast._subscribers.keys())


hub = Hub()


async def websocket_receiver(websocket: WebSocket, client_id: str):
    log.info('[%s] - receive task', client_id)
    async for text in websocket.iter_text():
        log.debug('[%s] < %s [%s]', client_id, type(text), text)

        [join_ref, ref, topic, event, payload] = json.loads(text)
        if topic == 'phoenix' and event == 'heartbeat':
            log.debug('[%s] - heartbeat', client_id)
            message: List = [join_ref, ref, topic, 'phx_reply', {'status': 'ok', 'response': {}}]
            await broadcast.publish(channel=client_id, message=message)
            log.info('[%s] - heartbeat piped: %s [%s]', client_id, type(message), message)
            continue

        if event == 'phx_join':
            log.info('[%s] - want to join %s', client_id, topic)

            hub.join(client_id, topic)

            message = [join_ref, ref, topic, 'phx_reply', {'status': 'ok', 'response': {}}]
            await broadcast.publish(client_id, message)

            log.info('[%s] - piped: %s [%s]', client_id, type(message), message)
            continue

        if event == 'phx_leave':
            message = [join_ref, ref, topic, 'phx_reply', {'status': 'ok', 'response': {}}]
            await broadcast.publish(channel=client_id, message=message)
            log.info('[%s] - leave %s', client_id, topic)
            continue

        # TODO allowing all for now
        if topic in ['channel:system', 'channel:streaming'] and event in ['new-traffic', 'new-turb']:
            log.debug('[%s] - system broadcast', client_id)

            # response
            message = [None, ref, topic, 'phx_reply', {'status': 'ok', 'response': {}}]
            await broadcast.publish(channel=client_id, message=message)

            # broadcast
            for subscriber in hub.clients():
                if subscriber == client_id:
                    continue
                message = [None, None, topic, event, payload]
                await broadcast.publish(channel=subscriber, message=message)
            continue

        log.info('unkown topic: %s, event: %s, payload: %s', topic, event, payload)

        # TODO: move this into plugin module
        if topic == 'channel:streaming' and event.startswith('plugin:'):
            _, plugin_name, plugin_event = event.split(':')
            log.info('plugin: %s, event: %s', plugin_name, plugin_event)
            # let's assume `rs1090_plugin` for now
            if plugin_event in rs1090_source.event_handlers:
                rs1090_source.event_handlers[plugin_event](payload)
                log.info('called plugin event handler')
            else:
                log.info('event handler not found')

        message = [None, None, topic, 'phx_reply', {'status': 'ok', 'response': {}}]
        await broadcast.publish(channel=client_id, message=message)

    # TODO cleanup
    log.debug('[%s] done')


async def websocket_sender(websocket: WebSocket, client_id: str):
    log.info('[%s] > send task', client_id)
    async with broadcast.subscribe(client_id) as subscriber:
        log.info('[%s] > new subscriber created, %s', client_id, subscriber)
        async for event in subscriber:
            # log.info('ev: %s', event)
            message = event.message
            await websocket.send_text(json.dumps(message))
            # log.debug('[%s] > message sent: %s', client_id, message)
    log.info('[%s] sending task is done', client_id)


@app.websocket("/websocket")
async def websocket_handler(ws: WebSocket):
    await ws.accept()
    log.info('%s\n', '-' * 20)

    client_id: str = str(uuid.uuid4())
    log.info('connected, ws: %s, client: %s', ws, client_id)

    await run_until_first_complete(
        (websocket_receiver, {"websocket": ws, 'client_id': client_id}),
        (websocket_sender, {"websocket": ws, 'client_id': client_id}),
    )
    log.info('connection done, ws: %s, client: %s', ws, client_id)
    log.info('%s\n', '+' * 20)


class Greeting(BaseModel):
    channel: str
    event: str = 'new-data'
    message: str | None = None


@app.post('/admin/publish')
async def post(greeting: Greeting):
    message = [None, None, greeting.channel, greeting.event, json.loads(greeting.message)]
    for client_id in hub.channel_clients().get(greeting.channel, []):
        await broadcast.publish(channel=client_id, message=message)
        log.debug('sent to %s', client_id)


@app.get('/admin/channel-clients')
async def get_map():
    return hub.channel_clients()


@app.get('/admin/channels')
async def list_channels():
    return hub.channels()


@app.get('/admin/clients')
async def clients():
    return hub.clients()

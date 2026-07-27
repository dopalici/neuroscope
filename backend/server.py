"""FastAPI WebSocket server: the bridge between processing and the browser.

Run it with:
    python -m backend.server            # simulation mode (default)
    NEUROSCOPE_SOURCE=lsl python -m backend.server   # real Muse via muselsl

Or pass a flag:
    python -m backend.server --source lsl
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .processing.pipeline import Pipeline
from .sources import create_source


def _json_default(o):
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"Not JSON serializable: {type(o)}")


class Hub:
    """Owns the data source, the pipeline, and the set of connected clients."""

    def __init__(self, mode: str):
        self.mode = mode
        self.source = create_source(mode)
        self.pipeline = Pipeline()
        self.clients: set[WebSocket] = set()
        self._task: asyncio.Task | None = None
        self._started = False
        self.last_error: str | None = None

    def ensure_started(self) -> None:
        if self._started:
            return
        self.source.start()
        self._started = True

    async def run_loop(self) -> None:
        """Poll the source, process, and broadcast frames at UPDATE_RATE_HZ."""
        period = 1.0 / config.UPDATE_RATE_HZ
        while True:
            tick = asyncio.get_event_loop().time()
            try:
                batch = self.source.poll()
                self.pipeline.add(batch)
                frame = self.pipeline.frame()
                await self._broadcast(frame)
            except Exception as exc:  # keep the loop alive; report once
                self.last_error = repr(exc)
                print(f"[hub] processing error: {exc!r}")
            elapsed = asyncio.get_event_loop().time() - tick
            await asyncio.sleep(max(0.0, period - elapsed))

    async def _broadcast(self, message: dict) -> None:
        if not self.clients:
            return
        payload = json.dumps(message, default=_json_default)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def register(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        meta = self.pipeline.meta(self.source.name, self.source.is_simulated)
        await ws.send_text(json.dumps(meta, default=_json_default))

    def unregister(self, ws: WebSocket) -> None:
        self.clients.discard(ws)


def create_app(mode: str | None = None) -> FastAPI:
    mode = mode or os.environ.get("NEUROSCOPE_SOURCE", "sim")
    hub = Hub(mode)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            hub.ensure_started()
            hub._task = asyncio.create_task(hub.run_loop())
            print(f"[startup] NeuroScope running | source={hub.source.name} "
                  f"| simulated={hub.source.is_simulated}")
        except Exception as exc:
            hub.last_error = repr(exc)
            print(f"[startup] could not start source {mode!r}: {exc!r}")
        try:
            yield
        finally:
            if hub._task:
                hub._task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await hub._task
            with contextlib.suppress(Exception):
                hub.source.stop()

    app = FastAPI(title="NeuroScope Muse 2 Dashboard", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.hub = hub

    @app.get("/api/health")
    async def health():
        return JSONResponse({
            "status": "ok" if hub._started else "error",
            "source": hub.source.name,
            "simulated": hub.source.is_simulated,
            "clients": len(hub.clients),
            "last_error": hub.last_error,
        })

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await hub.register(ws)
        try:
            while True:
                # We don't expect messages from the client, but keep the socket
                # alive and drain anything it sends (e.g. pings).
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            hub.unregister(ws)

    return app


def main():
    parser = argparse.ArgumentParser(description="NeuroScope Muse 2 backend")
    parser.add_argument("--source", default=None,
                        help="Data source: 'sim' (default) or 'lsl' (real Muse)")
    parser.add_argument("--host", default=config.SERVER_HOST)
    parser.add_argument("--port", type=int, default=config.SERVER_PORT)
    args = parser.parse_args()

    import uvicorn
    app = create_app(args.source)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


# `uvicorn backend.server:app` also works (uses the env var for the mode).
app = create_app()

if __name__ == "__main__":
    main()

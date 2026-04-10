from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    get_gis_route_context,
    get_route_engine,
    get_subway_network,
    router as api_router,
)
from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm heavy caches at startup to reduce first-request latency.
    get_route_engine()
    network = get_subway_network()
    get_gis_route_context(network)
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.include_router(api_router)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
app.mount("/map", StaticFiles(directory=settings.map_dir), name="map")


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/")
async def index():
    return FileResponse(Path(settings.static_dir) / "gis-studio" / "index.html")


@app.get("/login")
async def login():
    return FileResponse(Path(settings.static_dir) / "route-studio" / "index.html")


@app.get("/calibrate")
async def calibrate():
    return FileResponse(Path(settings.static_dir) / "calibration" / "index.html")


@app.get("/builder")
async def builder():
    return FileResponse(Path(settings.static_dir) / "builder" / "index.html")


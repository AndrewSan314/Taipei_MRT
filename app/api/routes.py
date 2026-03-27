from __future__ import annotations

from pydantic import BaseModel
from pydantic import Field

from fastapi import APIRouter
from fastapi import HTTPException

from app.config import get_settings
from app.services.calibration_store import save_station_positions
from app.services.gis_loader import build_gis_payload
from app.services.gis_route import extract_station_coordinates
from app.services.gis_route import nearest_station
from app.services.gis_route import walking_time_sec
from app.services.subway_network_store import load_network_definition
from app.services.subway_network_store import save_network_definition
from app.services.runtime import get_network as get_subway_network
from app.services.runtime import get_route_engine
from app.services.runtime import refresh_runtime_caches

router = APIRouter(prefix="/api", tags=["subway"])
settings = get_settings()


class RouteRequest(BaseModel):
    start_station_id: str
    end_station_id: str
    via_station_ids: list[str] = Field(default_factory=list)


class PointRouteRequest(BaseModel):
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    walking_seconds_per_pixel: float = 1.0
    candidate_limit: int | None = None
    max_station_walk_sec: int | None = None
    start_preferred_line_ids: list[str] = Field(default_factory=list)
    end_preferred_line_ids: list[str] = Field(default_factory=list)
    via_station_ids: list[str] = Field(default_factory=list)


class GisPointRouteRequest(BaseModel):
    start_lon: float
    start_lat: float
    end_lon: float
    end_lat: float
    walking_m_per_sec: float = 1.3
    via_station_ids: list[str] = Field(default_factory=list)


class CalibrationStationPayload(BaseModel):
    id: str
    x: float
    y: float


class CalibrationSaveRequest(BaseModel):
    stations: list[CalibrationStationPayload]


class BuilderStationPayload(BaseModel):
    id: str
    name: str
    x: float
    y: float


class BuilderLinePayload(BaseModel):
    id: str
    name: str
    color: str


class BuilderStationLinePayload(BaseModel):
    station_id: str
    line_id: str
    seq: int


class BuilderNetworkSaveRequest(BaseModel):
    stations: list[BuilderStationPayload]
    lines: list[BuilderLinePayload]
    station_lines: list[BuilderStationLinePayload]
    default_travel_sec: int = 90
    default_transfer_sec: int = 180


def _network_payload() -> dict:
    network = get_subway_network()
    return {
        "map": {
            "image_url": f"/map/{settings.map_image_name}",
            "width": settings.map_width,
            "height": settings.map_height,
            "raster_width": settings.map_width,
            "raster_height": settings.map_height,
            "is_vector": settings.map_is_vector,
            "supports_line_hints": settings.map_supports_line_hints,
            "max_zoom": settings.map_max_zoom,
            "title": "Taipei vector map background",
        },
        "diagram": {
            "svg_url": f"/map/{settings.diagram_svg_name}",
            "width": settings.diagram_width,
            "height": settings.diagram_height,
            "raster_width": settings.diagram_raster_width,
            "raster_height": settings.diagram_raster_height,
            "is_vector": settings.diagram_is_vector,
            "max_zoom": settings.diagram_max_zoom,
            "title": "Taipei MRT semantic SVG diagram",
        },
        "stations": [
            {
                "id": station.id,
                "name": station.name,
                "x": station.x,
                "y": station.y,
                "diagram_x": station.diagram_x,
                "diagram_y": station.diagram_y,
                "line_ids": sorted(network.station_to_lines[station.id]),
            }
            for station in sorted(network.stations.values(), key=lambda item: item.name)
        ],
        "lines": [
            {"id": line.id, "name": line.name, "color": line.color}
            for line in network.lines.values()
        ],
        "segments": [
            {
                "line_id": segment.line_id,
                "from_station_id": segment.from_station_id,
                "to_station_id": segment.to_station_id,
                "travel_sec": segment.travel_sec,
            }
            for segment in network.segments
        ],
        "source": network.metadata.get("source_kind", "json"),
    }


def _station_lookup_payload() -> dict[str, dict]:
    return {
        station["id"]: station
        for station in _network_payload()["stations"]
    }


def _enrich_route_payload(route_payload: dict, station_lookup: dict[str, dict], network) -> dict:
    route_payload["stations"] = [
        station_lookup[station_id]
        for station_id in route_payload["station_ids"]
    ]
    route_payload["line_labels"] = [
        network.lines[line_id].name
        for line_id in route_payload["line_sequence"]
    ]
    return route_payload


def _build_network_payload_from_builder(request: BuilderNetworkSaveRequest) -> dict:
    runtime_network = get_subway_network()
    existing_station_lookup = {
        station.id: {
            "x": station.x,
            "y": station.y,
        }
        for station in runtime_network.stations.values()
    }

    station_ids = [station.id for station in request.stations]
    line_ids = [line.id for line in request.lines]

    if len(station_ids) != len(set(station_ids)):
        raise HTTPException(status_code=400, detail="Duplicate station id detected")
    if len(line_ids) != len(set(line_ids)):
        raise HTTPException(status_code=400, detail="Duplicate line id detected")
    if request.default_travel_sec <= 0:
        raise HTTPException(status_code=400, detail="default_travel_sec must be > 0")
    if request.default_transfer_sec <= 0:
        raise HTTPException(status_code=400, detail="default_transfer_sec must be > 0")

    known_station_ids = set(station_ids)
    known_line_ids = set(line_ids)

    line_membership: dict[str, list[BuilderStationLinePayload]] = {}
    for station_line in request.station_lines:
        if station_line.station_id not in known_station_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown station_id in station_lines: {station_line.station_id}",
            )
        if station_line.line_id not in known_line_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown line_id in station_lines: {station_line.line_id}",
            )
        if station_line.seq <= 0:
            raise HTTPException(status_code=400, detail="station_lines seq must be > 0")

        line_membership.setdefault(station_line.line_id, []).append(station_line)

    segments: list[dict] = []
    station_to_lines: dict[str, set[str]] = {}

    for line_id, station_lines in line_membership.items():
        ordered = sorted(station_lines, key=lambda item: (item.seq, item.station_id))
        seen_station_ids: set[str] = set()
        ordered_station_ids: list[str] = []

        for station_line in ordered:
            if station_line.station_id in seen_station_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"Duplicate station {station_line.station_id} on line {line_id}",
                )
            seen_station_ids.add(station_line.station_id)
            ordered_station_ids.append(station_line.station_id)
            station_to_lines.setdefault(station_line.station_id, set()).add(line_id)

        for from_station_id, to_station_id in zip(ordered_station_ids, ordered_station_ids[1:], strict=False):
            segments.append(
                {
                    "line_id": line_id,
                    "from_station_id": from_station_id,
                    "to_station_id": to_station_id,
                    "travel_sec": request.default_travel_sec,
                }
            )

    transfers: list[dict] = []
    for station_id, station_line_ids in sorted(station_to_lines.items()):
        ordered_line_ids = sorted(station_line_ids)
        for from_line_id in ordered_line_ids:
            for to_line_id in ordered_line_ids:
                if from_line_id == to_line_id:
                    continue
                transfers.append(
                    {
                        "station_id": station_id,
                        "from_line_id": from_line_id,
                        "to_line_id": to_line_id,
                        "transfer_sec": request.default_transfer_sec,
                    }
                )

    return {
        "stations": [
            {
                "id": station.id,
                "name": station.name,
                "x": existing_station_lookup.get(station.id, {}).get("x", station.x),
                "y": existing_station_lookup.get(station.id, {}).get("y", station.y),
                "diagram_x": station.x,
                "diagram_y": station.y,
            }
            for station in request.stations
        ],
        "lines": [
            {
                "id": line.id,
                "name": line.name,
                "color": line.color,
            }
            for line in request.lines
        ],
        "station_lines": [
            {
                "station_id": station_line.station_id,
                "line_id": station_line.line_id,
                "seq": station_line.seq,
            }
            for station_line in sorted(request.station_lines, key=lambda item: (item.line_id, item.seq, item.station_id))
        ],
        "segments": segments,
        "transfers": transfers,
        "metadata": {
            "source_kind": "builder",
        },
    }


@router.get("/network")
async def get_network():
    return _network_payload()


@router.get("/gis/network")
async def get_gis_network():
    network = get_subway_network()
    fallback_bounds = (
        settings.fallback_min_lon,
        settings.fallback_min_lat,
        settings.fallback_max_lon,
        settings.fallback_max_lat,
    )
    return build_gis_payload(
        network=network,
        qgis_geojson_dir=settings.qgis_geojson_dir,
        map_width=settings.map_width,
        map_height=settings.map_height,
        fallback_bounds=fallback_bounds,
    )


@router.post("/gis/route/points")
async def get_gis_route_for_points(request: GisPointRouteRequest):
    if request.walking_m_per_sec <= 0:
        raise HTTPException(status_code=400, detail="walking_m_per_sec must be > 0")

    network = get_subway_network()
    for via_station_id in request.via_station_ids:
        if via_station_id not in network.stations:
            raise HTTPException(status_code=400, detail=f"Unknown via station: {via_station_id}")

    fallback_bounds = (
        settings.fallback_min_lon,
        settings.fallback_min_lat,
        settings.fallback_max_lon,
        settings.fallback_max_lat,
    )
    gis_payload = build_gis_payload(
        network=network,
        qgis_geojson_dir=settings.qgis_geojson_dir,
        map_width=settings.map_width,
        map_height=settings.map_height,
        fallback_bounds=fallback_bounds,
    )
    station_coords_by_id = extract_station_coordinates(gis_payload["stations"])
    if not station_coords_by_id:
        raise HTTPException(status_code=500, detail="GIS station coordinates are unavailable")

    try:
        selected_start_station_id, access_walk_distance_m = nearest_station(
            request.start_lon,
            request.start_lat,
            station_coords_by_id,
        )
        selected_end_station_id, egress_walk_distance_m = nearest_station(
            request.end_lon,
            request.end_lat,
            station_coords_by_id,
        )

        engine = get_route_engine()
        route_result = engine.find_route_through_stations(
            [
                selected_start_station_id,
                *request.via_station_ids,
                selected_end_station_id,
            ]
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    access_walk_time_sec = walking_time_sec(access_walk_distance_m, request.walking_m_per_sec)
    egress_walk_time_sec = walking_time_sec(egress_walk_distance_m, request.walking_m_per_sec)
    station_lookup = _station_lookup_payload()
    route_payload = _enrich_route_payload(route_result.to_dict(), station_lookup, network)

    return {
        "source": gis_payload["source"],
        "start_point": {"lon": request.start_lon, "lat": request.start_lat},
        "end_point": {"lon": request.end_lon, "lat": request.end_lat},
        "selected_start_station": {
            **station_lookup[selected_start_station_id],
            "lon": station_coords_by_id[selected_start_station_id][0],
            "lat": station_coords_by_id[selected_start_station_id][1],
        },
        "selected_end_station": {
            **station_lookup[selected_end_station_id],
            "lon": station_coords_by_id[selected_end_station_id][0],
            "lat": station_coords_by_id[selected_end_station_id][1],
        },
        "via_stations": [
            {
                **station_lookup[station_id],
                "lon": station_coords_by_id.get(station_id, (None, None))[0],
                "lat": station_coords_by_id.get(station_id, (None, None))[1],
            }
            for station_id in request.via_station_ids
        ],
        "access_walk_distance_m": round(access_walk_distance_m, 1),
        "egress_walk_distance_m": round(egress_walk_distance_m, 1),
        "access_walk_time_sec": access_walk_time_sec,
        "egress_walk_time_sec": egress_walk_time_sec,
        "total_journey_time_sec": (
            route_payload["total_time_sec"] + access_walk_time_sec + egress_walk_time_sec
        ),
        "route": route_payload,
    }


@router.get("/builder/network")
async def get_builder_network():
    payload = load_network_definition(settings.data_file)
    payload["map"] = _network_payload()["map"]
    payload["diagram"] = _network_payload()["diagram"]
    return payload


@router.post("/route")
async def get_route(request: RouteRequest):
    engine = get_route_engine()
    network = get_subway_network()
    try:
        result = engine.find_route_through_stations(
            [
                request.start_station_id,
                *request.via_station_ids,
                request.end_station_id,
            ]
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    return _enrich_route_payload(result.to_dict(), _station_lookup_payload(), network)


@router.post("/route/points")
async def get_route_for_points(request: PointRouteRequest):
    engine = get_route_engine()
    network = get_subway_network()
    try:
        result = engine.find_best_route_for_points(
            start_x=request.start_x,
            start_y=request.start_y,
            end_x=request.end_x,
            end_y=request.end_y,
            walking_seconds_per_pixel=request.walking_seconds_per_pixel,
            candidate_limit=request.candidate_limit,
            max_station_walk_sec=request.max_station_walk_sec
            if request.max_station_walk_sec is not None
            else settings.point_route_max_station_walk_sec,
            start_preferred_line_ids=request.start_preferred_line_ids,
            end_preferred_line_ids=request.end_preferred_line_ids,
            via_station_ids=request.via_station_ids,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    result["route"] = _enrich_route_payload(
        result["route"],
        _station_lookup_payload(),
        network,
    )
    return result


@router.post("/calibration/stations")
async def save_calibration(request: CalibrationSaveRequest):
    positions = {
        station.id: {"x": station.x, "y": station.y}
        for station in request.stations
    }
    updated_count = save_station_positions(settings.station_positions_file, positions)
    refresh_runtime_caches()
    return {
        "message": "Station coordinates saved",
        "updated_count": updated_count,
    }


@router.post("/builder/network")
async def save_builder_network(request: BuilderNetworkSaveRequest):
    payload = _build_network_payload_from_builder(request)
    saved = save_network_definition(settings.data_file, payload)
    refresh_runtime_caches()
    return {
        "message": "Network definition saved",
        "saved": saved,
    }

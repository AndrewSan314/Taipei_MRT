from __future__ import annotations

from pydantic import BaseModel
from pydantic import Field

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi.responses import Response

from app.config import get_settings
from app.services.admin_scenarios import apply_admin_scenarios_to_network
from app.services.admin_scenarios import build_admin_scenario_effects
from app.services.admin_scenarios import default_admin_scenarios
from app.services.admin_scenarios import load_admin_scenarios
from app.services.admin_scenarios import save_admin_scenarios as save_admin_scenarios_in_store
from app.services.gis_loader import build_gis_payload
from app.services.gis_station_store import delete_gis_station as delete_gis_station_in_store
from app.services.gis_station_store import save_gis_station_positions
from app.services.gis_loader import get_cached_walk_graph
from app.services.gis_route import find_candidate_stations_by_walk
from app.services.gis_route import extract_station_coordinates
from app.services.gis_route_geometry import build_ride_path_features
from app.services.gis_route import build_walk_graph
from app.services.gis_route import walking_time_sec
from app.services.mbtiles import get_mbtiles_metadata
from app.services.mbtiles import read_mbtiles_tile
from app.services.route_engine import RouteEngine
from app.services.runtime import get_network as get_subway_network
from app.services.runtime import get_route_engine

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


class GisStationPositionPayload(BaseModel):
    id: str
    lon: float
    lat: float
    deleted: bool = False


class GisStationSaveRequest(BaseModel):
    stations: list[GisStationPositionPayload]


class AdminCoordinatePayload(BaseModel):
    lon: float
    lat: float


class AdminRainZonePayload(BaseModel):
    id: str | None = None
    center: AdminCoordinatePayload
    radius_m: int


class AdminBlockSegmentPayload(BaseModel):
    id: str | None = None
    kind: str = "line"
    from_: AdminCoordinatePayload = Field(alias="from")
    to: AdminCoordinatePayload


class AdminBannedStationPayload(BaseModel):
    id: str
    name: str | None = None
    lon: float | None = None
    lat: float | None = None


class AdminScenarioSaveRequest(BaseModel):
    source: str | None = None
    generated_at: str | None = None
    ui_mode: str = "rain"
    map_bounds: dict | None = None
    rain_zones: list[AdminRainZonePayload] = Field(default_factory=list)
    block_segments: list[AdminBlockSegmentPayload] = Field(default_factory=list)
    banned_stations: list[AdminBannedStationPayload] = Field(default_factory=list)


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


def _raise_legacy_api_removed() -> None:
    raise HTTPException(
        status_code=410,
        detail="Legacy studio API has been removed. Use /api/gis/* instead.",
    )


def _network_payload(network=None) -> dict:
    network = network or get_subway_network()
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


def _station_lookup_payload_for_network(network) -> dict[str, dict]:
    return {
        station["id"]: station
        for station in _network_payload(network)["stations"]
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


def _build_gis_payload_for_network(network, include_walk_network: bool = False) -> dict:
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
        include_walk_network=include_walk_network,
    )


def _serialize_admin_scenarios(request: AdminScenarioSaveRequest) -> dict:
    return {
        "source": request.source or "server",
        "generated_at": request.generated_at,
        "ui_mode": request.ui_mode,
        "map_bounds": request.map_bounds,
        "rain_zones": [
            {
                "id": item.id,
                "center": {
                    "lon": item.center.lon,
                    "lat": item.center.lat,
                },
                "radius_m": item.radius_m,
            }
            for item in request.rain_zones
        ],
        "block_segments": [
            {
                "id": item.id,
                "kind": item.kind,
                "from": {
                    "lon": item.from_.lon,
                    "lat": item.from_.lat,
                },
                "to": {
                    "lon": item.to.lon,
                    "lat": item.to.lat,
                },
            }
            for item in request.block_segments
        ],
        "banned_stations": [
            {
                "id": item.id,
                "name": item.name,
                "lon": item.lon,
                "lat": item.lat,
            }
            for item in request.banned_stations
        ],
    }


def _admin_scenario_response(scenarios: dict, network=None) -> dict:
    network = network or get_subway_network()
    gis_payload = _build_gis_payload_for_network(network, include_walk_network=False)
    effects = build_admin_scenario_effects(network, gis_payload, scenarios)
    return {
        "scenarios": scenarios,
        "effects": effects,
    }


def _start_station_attempt_payload(
    walk_result,
    status: str,
    reason: str | None = None,
) -> dict:
    payload = {
        "station_id": walk_result.station_id,
        "distance_m": round(walk_result.distance_m, 1),
        "access_point_name": walk_result.access_point_name,
        "status": status,
    }
    if reason:
        payload["reason"] = reason
    return payload


def _select_walk_candidate(
    candidates,
    allowed_station_ids: set[str],
    disallowed_station_ids: set[str],
    disallowed_reason: str,
):
    attempts: list[dict] = []
    for candidate in candidates:
        if candidate.station_id not in allowed_station_ids:
            attempts.append(
                _start_station_attempt_payload(
                    candidate,
                    status="rejected",
                    reason="station_unavailable_under_current_incidents",
                )
            )
            continue
        if candidate.station_id in disallowed_station_ids:
            attempts.append(
                _start_station_attempt_payload(
                    candidate,
                    status="rejected",
                    reason=disallowed_reason,
                )
            )
            continue

        attempts.append(
            _start_station_attempt_payload(
                candidate,
                status="selected",
            )
        )
        return candidate, attempts

    return None, attempts


@router.get("/network")
async def get_network():
    _raise_legacy_api_removed()


@router.get("/admin/scenarios")
async def get_admin_scenarios():
    scenarios = load_admin_scenarios(settings.admin_scenarios_file)
    return _admin_scenario_response(scenarios)


@router.put("/admin/scenarios")
async def save_admin_scenarios(request: AdminScenarioSaveRequest):
    scenarios = save_admin_scenarios_in_store(
        settings.admin_scenarios_file,
        _serialize_admin_scenarios(request),
    )
    return _admin_scenario_response(scenarios)


@router.delete("/admin/scenarios")
async def reset_admin_scenarios():
    scenarios = save_admin_scenarios_in_store(
        settings.admin_scenarios_file,
        default_admin_scenarios(),
    )
    return _admin_scenario_response(scenarios)


@router.get("/gis/network")
async def get_gis_network():
    network = get_subway_network()
    fallback_bounds = (
        settings.fallback_min_lon,
        settings.fallback_min_lat,
        settings.fallback_max_lon,
        settings.fallback_max_lat,
    )
    payload = build_gis_payload(
        network=network,
        qgis_geojson_dir=settings.qgis_geojson_dir,
        map_width=settings.map_width,
        map_height=settings.map_height,
        fallback_bounds=fallback_bounds,
        include_station_access_points=False,
        include_walk_network=False,
        merge_missing_stations=False,
    )
    payload["station_catalog"] = [
        {
            "id": station.id,
            "name": station.name,
            "line_ids": sorted(network.station_to_lines.get(station.id, set())),
        }
        for station in sorted(network.stations.values(), key=lambda item: item.name)
    ]
    payload["line_catalog"] = [
        {
            "id": line.id,
            "name": line.name,
            "color": line.color,
        }
        for line in sorted(network.lines.values(), key=lambda item: item.id)
    ]
    basemap = get_mbtiles_metadata(settings.gis_mbtiles_file)
    if basemap is None:
        payload["basemap"] = {
            "enabled": False,
            "type": "osm_raster_fallback",
            "bounds": payload["bounds"],
        }
        return payload

    payload["basemap"] = {
        **basemap,
        "tiles_url": "/api/gis/basemap/tiles/{z}/{x}/{y}",
    }
    return payload


@router.get("/gis/basemap/tiles/{z}/{x}/{y}")
async def get_gis_basemap_tile(z: int, x: int, y: int):
    tile = read_mbtiles_tile(settings.gis_mbtiles_file, z, x, y)
    if tile is None:
        raise HTTPException(status_code=404, detail="Basemap tile not found")

    tile_data, media_type = tile
    return Response(
        content=tile_data,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/gis/stations")
async def save_gis_stations(request: GisStationSaveRequest):
    positions = {
        station.id: {
            "lon": station.lon,
            "lat": station.lat,
            "deleted": station.deleted,
        }
        for station in request.stations
    }
    try:
        updated_count = save_gis_station_positions(
            settings.qgis_geojson_dir / "stations.geojson",
            positions,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {
        "message": "GIS station coordinates saved",
        "updated_count": updated_count,
    }


@router.delete("/gis/stations/{station_id}")
async def delete_gis_station(station_id: str):
    try:
        updated_count = delete_gis_station_in_store(
            settings.qgis_geojson_dir / "stations.geojson",
            station_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {
        "message": "GIS station marked deleted",
        "updated_count": updated_count,
    }


@router.post("/gis/route/points")
async def get_gis_route_for_points(request: GisPointRouteRequest):
    if request.walking_m_per_sec <= 0:
        raise HTTPException(status_code=400, detail="walking_m_per_sec must be > 0")

    network = get_subway_network()
    gis_payload = _build_gis_payload_for_network(network, include_walk_network=False)
    scenarios = load_admin_scenarios(settings.admin_scenarios_file)
    admin_effects = build_admin_scenario_effects(network, gis_payload, scenarios)
    network_for_route = apply_admin_scenarios_to_network(network, admin_effects)
    route_available_station_ids = set(network_for_route.stations)
    rain_station_ids = set(admin_effects.get("rain_station_ids", []))

    for via_station_id in request.via_station_ids:
        if via_station_id not in network.stations:
            raise HTTPException(status_code=400, detail=f"Unknown via station: {via_station_id}")
        if via_station_id not in network_for_route.stations:
            raise HTTPException(
                status_code=400,
                detail=f"Via station is unavailable under current admin scenarios: {via_station_id}",
            )

    station_coords_by_id = {
        station_id: coordinate
        for station_id, coordinate in extract_station_coordinates(gis_payload["stations"]).items()
        if station_id in network_for_route.stations
    }
    all_station_coords_by_id = extract_station_coordinates(gis_payload["stations"])
    if not station_coords_by_id:
        raise HTTPException(status_code=500, detail="GIS station coordinates are unavailable")

    try:
        walk_graph = (
            build_walk_graph(gis_payload.get("walk_network"))
            if gis_payload.get("walk_network") is not None
            else get_cached_walk_graph(settings.qgis_geojson_dir)
        )
        start_walk_candidates = find_candidate_stations_by_walk(
            request.start_lon,
            request.start_lat,
            all_station_coords_by_id,
            gis_payload.get("station_access_points"),
            None,
            walk_graph=walk_graph,
        )
        end_walk_candidates = find_candidate_stations_by_walk(
            request.end_lon,
            request.end_lat,
            all_station_coords_by_id,
            gis_payload.get("station_access_points"),
            None,
            walk_graph=walk_graph,
        )
        end_walk_result, end_station_attempts = _select_walk_candidate(
            end_walk_candidates,
            route_available_station_ids,
            rain_station_ids,
            "station_in_rain_zone",
        )
        if end_walk_result is None:
            raise ValueError("No destination station is available outside the current rain zone and incident set")
        selected_end_station_id = end_walk_result.station_id
        egress_walk_distance_m = end_walk_result.distance_m

        engine = get_route_engine() if not admin_effects["has_active_incidents"] else RouteEngine(network_for_route)
        start_walk_result = None
        route_result = None
        start_station_attempts: list[dict] = []
        for candidate in start_walk_candidates:
            if candidate.station_id not in route_available_station_ids:
                start_station_attempts.append(
                    _start_station_attempt_payload(
                        candidate,
                        status="rejected",
                        reason="station_unavailable_under_current_incidents",
                    )
                )
                continue
            if candidate.station_id in rain_station_ids:
                start_station_attempts.append(
                    _start_station_attempt_payload(
                        candidate,
                        status="rejected",
                        reason="station_in_rain_zone",
                    )
                )
                continue

            try:
                candidate_route_result = engine.find_route_through_stations(
                    [
                        candidate.station_id,
                        *request.via_station_ids,
                        selected_end_station_id,
                    ]
                )
            except ValueError:
                start_station_attempts.append(
                    _start_station_attempt_payload(
                        candidate,
                        status="rejected",
                        reason="no_route_to_selected_destination_station",
                    )
                )
                continue

            start_walk_result = candidate
            route_result = candidate_route_result
            start_station_attempts.append(
                _start_station_attempt_payload(
                    candidate,
                    status="selected",
                )
            )
            break

        if start_walk_result is None or route_result is None:
            raise ValueError("No route found from any nearby start station to the selected destination station")

        selected_start_station_id = start_walk_result.station_id
        access_walk_distance_m = start_walk_result.distance_m
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    access_walk_time_sec = walking_time_sec(access_walk_distance_m, request.walking_m_per_sec)
    egress_walk_time_sec = walking_time_sec(egress_walk_distance_m, request.walking_m_per_sec)
    station_lookup = _station_lookup_payload_for_network(network_for_route)
    route_payload = _enrich_route_payload(route_result.to_dict(), station_lookup, network_for_route)
    ride_path_features = build_ride_path_features(
        route_steps=route_payload.get("steps", []),
        station_coords_by_id=station_coords_by_id,
        stations_geojson=gis_payload.get("stations"),
        lines_geojson=gis_payload.get("lines"),
    )

    return {
        "source": gis_payload["source"],
        "start_point": {"lon": request.start_lon, "lat": request.start_lat},
        "end_point": {"lon": request.end_lon, "lat": request.end_lat},
        "selected_start_station": {
            **station_lookup[selected_start_station_id],
            "lon": station_coords_by_id[selected_start_station_id][0],
            "lat": station_coords_by_id[selected_start_station_id][1],
        },
        "selected_start_access_point": {
            "name": start_walk_result.access_point_name,
            "lon": start_walk_result.access_point_coordinate[0],
            "lat": start_walk_result.access_point_coordinate[1],
        },
        "selected_end_station": {
            **station_lookup[selected_end_station_id],
            "lon": station_coords_by_id[selected_end_station_id][0],
            "lat": station_coords_by_id[selected_end_station_id][1],
        },
        "selected_end_access_point": {
            "name": end_walk_result.access_point_name,
            "lon": end_walk_result.access_point_coordinate[0],
            "lat": end_walk_result.access_point_coordinate[1],
        },
        "via_stations": [
            {
                **station_lookup[station_id],
                "lon": station_coords_by_id.get(station_id, (None, None))[0],
                "lat": station_coords_by_id.get(station_id, (None, None))[1],
            }
            for station_id in request.via_station_ids
        ],
        "access_walk_path": {
            "type": "LineString",
            "coordinates": [
                [path_lon, path_lat]
                for path_lon, path_lat in start_walk_result.path_coordinates
            ],
        },
        "egress_walk_path": {
            "type": "LineString",
            "coordinates": [
                [path_lon, path_lat]
                for path_lon, path_lat in end_walk_result.path_coordinates
            ],
        },
        "access_walk_distance_m": round(access_walk_distance_m, 1),
        "egress_walk_distance_m": round(egress_walk_distance_m, 1),
        "access_walk_time_sec": access_walk_time_sec,
        "egress_walk_time_sec": egress_walk_time_sec,
        "ride_path_features": ride_path_features,
        "total_journey_time_sec": (
            route_payload["total_time_sec"] + access_walk_time_sec + egress_walk_time_sec
        ),
        "admin_effects": admin_effects,
        "start_station_attempts": start_station_attempts,
        "end_station_attempts": end_station_attempts,
        "route": route_payload,
    }


@router.get("/builder/network")
async def get_builder_network():
    _raise_legacy_api_removed()


@router.post("/route")
async def get_route(request: RouteRequest):
    del request
    _raise_legacy_api_removed()


@router.post("/route/points")
async def get_route_for_points(request: PointRouteRequest):
    del request
    _raise_legacy_api_removed()


@router.post("/calibration/stations")
async def save_calibration(request: CalibrationSaveRequest):
    del request
    _raise_legacy_api_removed()


@router.post("/builder/network")
async def save_builder_network(request: BuilderNetworkSaveRequest):
    del request
    _raise_legacy_api_removed()

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.domain.models import SubwayNetwork


def build_gis_payload(
    network: SubwayNetwork,
    qgis_geojson_dir: Path,
    map_width: float,
    map_height: float,
    fallback_bounds: tuple[float, float, float, float],
) -> dict[str, Any]:
    stations_path = qgis_geojson_dir / "stations.geojson"
    lines_path = qgis_geojson_dir / "lines.geojson"

    qgis_stations = _load_geojson(stations_path)
    qgis_lines = _load_geojson(lines_path)

    if _is_valid_station_geojson(qgis_stations, network) and _is_valid_geojson(qgis_lines):
        source = "qgis_geojson"
        stations_geojson = qgis_stations
        lines_geojson = qgis_lines
    else:
        source = "fallback_projected"
        stations_geojson, lines_geojson = _build_fallback_geojson(
            network,
            map_width,
            map_height,
            fallback_bounds,
        )

    bounds = _compute_geojson_bounds(stations_geojson)
    return {
        "source": source,
        "bounds": bounds,
        "stations": stations_geojson,
        "lines": lines_geojson,
    }


def _load_geojson(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _is_valid_geojson(payload: dict[str, Any] | None) -> bool:
    return (
        isinstance(payload, dict)
        and payload.get("type") == "FeatureCollection"
        and isinstance(payload.get("features"), list)
    )


def _is_valid_station_geojson(payload: dict[str, Any] | None, network: SubwayNetwork) -> bool:
    if not _is_valid_geojson(payload):
        return False

    available_station_ids = {
        feature.get("properties", {}).get("id")
        for feature in payload.get("features", [])
    }
    required_station_ids = set(network.stations.keys())
    return required_station_ids.issubset(available_station_ids)


def _build_fallback_geojson(
    network: SubwayNetwork,
    map_width: float,
    map_height: float,
    fallback_bounds: tuple[float, float, float, float],
) -> tuple[dict[str, Any], dict[str, Any]]:
    stations_features = []
    for station in network.stations.values():
        lon, lat = _pixel_to_lonlat(
            station.x,
            station.y,
            map_width,
            map_height,
            fallback_bounds,
        )
        stations_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": station.id,
                    "name": station.name,
                    "line_ids": sorted(network.station_to_lines.get(station.id, set())),
                },
            }
        )

    lines_features = []
    for segment in network.segments:
        from_station = network.stations.get(segment.from_station_id)
        to_station = network.stations.get(segment.to_station_id)
        line = network.lines.get(segment.line_id)
        if from_station is None or to_station is None:
            continue

        from_lon, from_lat = _pixel_to_lonlat(
            from_station.x,
            from_station.y,
            map_width,
            map_height,
            fallback_bounds,
        )
        to_lon, to_lat = _pixel_to_lonlat(
            to_station.x,
            to_station.y,
            map_width,
            map_height,
            fallback_bounds,
        )
        lines_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[from_lon, from_lat], [to_lon, to_lat]],
                },
                "properties": {
                    "line_id": segment.line_id,
                    "line_name": line.name if line else segment.line_id,
                    "line_color": line.color if line else "#7b8794",
                    "from_station_id": segment.from_station_id,
                    "to_station_id": segment.to_station_id,
                    "travel_sec": segment.travel_sec,
                },
            }
        )

    return (
        {"type": "FeatureCollection", "features": stations_features},
        {"type": "FeatureCollection", "features": lines_features},
    )


def _pixel_to_lonlat(
    x: float,
    y: float,
    map_width: float,
    map_height: float,
    fallback_bounds: tuple[float, float, float, float],
) -> tuple[float, float]:
    min_lon, min_lat, max_lon, max_lat = fallback_bounds
    lon = min_lon + (float(x) / float(map_width)) * (max_lon - min_lon)
    lat = max_lat - (float(y) / float(map_height)) * (max_lat - min_lat)
    return round(lon, 7), round(lat, 7)


def _compute_geojson_bounds(payload: dict[str, Any]) -> list[float]:
    min_lon = float("inf")
    min_lat = float("inf")
    max_lon = float("-inf")
    max_lat = float("-inf")

    for feature in payload.get("features", []):
        coordinates = feature.get("geometry", {}).get("coordinates")
        for lon, lat in _iter_coordinates(coordinates):
            min_lon = min(min_lon, lon)
            min_lat = min(min_lat, lat)
            max_lon = max(max_lon, lon)
            max_lat = max(max_lat, lat)

    if min_lon == float("inf"):
        return [121.45, 24.95, 121.65, 25.15]
    return [min_lon, min_lat, max_lon, max_lat]


def _iter_coordinates(node: Any):
    if not isinstance(node, list):
        return
    if len(node) >= 2 and isinstance(node[0], (int, float)) and isinstance(node[1], (int, float)):
        yield float(node[0]), float(node[1])
        return
    for item in node:
        yield from _iter_coordinates(item)

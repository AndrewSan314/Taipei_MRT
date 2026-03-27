from __future__ import annotations

import math
from typing import Any


def extract_station_coordinates(stations_geojson: dict[str, Any]) -> dict[str, tuple[float, float]]:
    lookup: dict[str, tuple[float, float]] = {}
    for feature in stations_geojson.get("features", []):
        station_id = feature.get("properties", {}).get("id")
        coordinates = feature.get("geometry", {}).get("coordinates")
        if (
            not station_id
            or not isinstance(coordinates, list)
            or len(coordinates) < 2
        ):
            continue
        lookup[str(station_id)] = (float(coordinates[0]), float(coordinates[1]))
    return lookup


def nearest_station(
    lon: float,
    lat: float,
    station_coords_by_id: dict[str, tuple[float, float]],
) -> tuple[str, float]:
    if not station_coords_by_id:
        raise ValueError("No GIS stations available")

    best_station_id: str | None = None
    best_distance_m = float("inf")

    for station_id, (station_lon, station_lat) in station_coords_by_id.items():
        distance_m = haversine_distance_m(lat, lon, station_lat, station_lon)
        if distance_m < best_distance_m:
            best_distance_m = distance_m
            best_station_id = station_id

    if best_station_id is None:
        raise ValueError("No nearest station found")
    return best_station_id, best_distance_m


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6_371_000.0
    rad_lat1 = math.radians(lat1)
    rad_lon1 = math.radians(lon1)
    rad_lat2 = math.radians(lat2)
    rad_lon2 = math.radians(lon2)
    delta_lat = rad_lat2 - rad_lat1
    delta_lon = rad_lon2 - rad_lon1

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(rad_lat1) * math.cos(rad_lat2) * (math.sin(delta_lon / 2) ** 2)
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(1e-12, 1 - a)))
    return earth_radius_m * c


def walking_time_sec(distance_m: float, walking_m_per_sec: float) -> int:
    return max(0, int(round(distance_m / walking_m_per_sec)))

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from app.services.walk_network import build_walk_graph


STATION_NAME_ALIASES = {
    "jiannan rd": "jiannan road",
    "minquan w road": "minquan west road",
    "mrt taipei main station": "taipei main station",
    "taipei 101 world trade center": "taipei 101 world trade center",
}

WALKABLE_HIGHWAYS = {
    "cycleway",
    "footway",
    "living_street",
    "path",
    "pedestrian",
    "primary",
    "primary_link",
    "residential",
    "road",
    "secondary",
    "secondary_link",
    "service",
    "steps",
    "tertiary",
    "tertiary_link",
    "track",
    "trunk_link",
    "unclassified",
}

BLOCKED_ACCESS_VALUES = {"private", "no"}
SUPPORTED_TRANSIT_ROUTE_TYPES = {"subway", "light_rail", "tram"}
STATION_SNAP_DISTANCE_METERS = 300.0


def parse_other_tags(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    return {key: value for key, value in re.findall(r'"([^"]+)"=>"([^"]*)"', raw)}


def normalize_station_name(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        return ""

    normalized = normalized.replace("/", " ")
    normalized = normalized.replace("-", " ")
    normalized = normalized.replace(".", "")
    normalized = normalized.replace("w/", "with ")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    normalized = re.sub(r"^mrt\s+", "", normalized)
    normalized = re.sub(r"\bsta\b", "station", normalized)
    normalized = re.sub(r"\bstn\b", "station", normalized)
    normalized = re.sub(r"\bstation exit \d+\b", "", normalized)
    normalized = re.sub(r"\bexit \d+\b", "", normalized)
    normalized = normalized.replace(" w ", " west ")
    normalized = normalized.replace(" e ", " east ")
    normalized = normalized.replace(" rd ", " road ")
    normalized = normalized.replace(" rd", " road")
    normalized = normalized.replace(" taipei main ", " taipei main station ")
    normalized = normalized.replace(" station station", " station")
    normalized = normalized.replace("taipei main station station", "taipei main station")
    normalized = normalized.replace(" station", "")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return STATION_NAME_ALIASES.get(normalized, normalized)


def station_name_candidates(feature: dict[str, Any]) -> list[str]:
    props = feature.get("properties", {}) or {}
    tags = parse_other_tags(props.get("other_tags"))
    candidates = [
        tags.get("name:en"),
        tags.get("official_name:en"),
        tags.get("name"),
        props.get("name"),
        tags.get("name:zh"),
    ]

    derived_candidates: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        stripped = candidate.strip()
        if stripped:
            derived_candidates.append(stripped)

        match = re.match(r"^MRT\s+(.+?)\s+Station(?:\s+Exit\s+\d+)?$", stripped, re.IGNORECASE)
        if match:
            derived_candidates.append(match.group(1).strip())

        chinese_candidate = re.sub(r"\s+", "", stripped)
        if chinese_candidate.startswith("捷運") and "站" in chinese_candidate:
            prefixed_candidate = re.sub(r"\d+號出口.*$", "", chinese_candidate)
            prefixed_candidate = re.sub(r"站.*$", "站", prefixed_candidate)
            if prefixed_candidate:
                derived_candidates.append(prefixed_candidate)
        chinese_candidate = re.sub(r"^\s*捷運", "", chinese_candidate)
        chinese_candidate = re.sub(r"\d+號出口.*$", "", chinese_candidate)
        chinese_candidate = re.sub(r"站.*$", "站", chinese_candidate)
        if chinese_candidate and chinese_candidate != stripped:
            derived_candidates.append(chinese_candidate)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in derived_candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def is_subway_route_feature(feature: dict[str, Any]) -> bool:
    tags = parse_other_tags(feature.get("properties", {}).get("other_tags"))
    route_type = (tags.get("route") or "").lower()
    if route_type not in SUPPORTED_TRANSIT_ROUTE_TYPES:
        return False

    network = (tags.get("network") or tags.get("network:en") or "").lower()
    if "metro" in network or "捷運" in network:
        return True
    return True


def is_walkable_line_feature(feature: dict[str, Any]) -> bool:
    props = feature.get("properties", {}) or {}
    tags = parse_other_tags(props.get("other_tags"))
    highway = (props.get("highway") or "").lower()
    railway = (props.get("railway") or "").lower()
    waterway = (props.get("waterway") or "").lower()
    access = (tags.get("access") or "").lower()
    foot = (tags.get("foot") or "").lower()

    if railway or waterway:
        return False
    if highway not in WALKABLE_HIGHWAYS:
        return False
    if highway == "motorway":
        return False
    if access in BLOCKED_ACCESS_VALUES or foot == "no":
        return False
    return True


def build_taipei_gis_datasets(
    raw_geojson_dir: Path,
    output_dir: Path,
    network_path: Path | None = None,
) -> dict[str, int]:
    network_station_lookup, network_station_by_id, network_line_by_id = _load_network_station_lookup(
        network_path
    )
    points_path = raw_geojson_dir / "Points.geojson"
    route_lines_path = raw_geojson_dir / "Multilinestrings.geojson"
    raw_lines_path = raw_geojson_dir / "Lines.geojson"

    station_candidates: dict[str, list[dict[str, Any]]] = {}
    station_access_points: dict[str, list[dict[str, Any]]] = {}
    subway_line_features: list[dict[str, Any]] = []
    walk_network_features: list[dict[str, Any]] = []

    for feature in iter_geojson_features(points_path):
        _collect_station_points(
            feature,
            network_station_lookup,
            station_candidates,
            station_access_points,
        )

    for feature in iter_geojson_features(route_lines_path):
        if is_subway_route_feature(feature):
            subway_line_features.append(_to_subway_line_feature(feature, network_line_by_id))

    for feature in iter_geojson_features(raw_lines_path):
        if is_walkable_line_feature(feature):
            walk_network_features.append(_to_walk_network_feature(feature))

    walk_network_geojson = {"type": "FeatureCollection", "features": walk_network_features}
    walk_graph = build_walk_graph(walk_network_geojson)

    stations_geojson = _build_station_feature_collection(
        network_station_by_id,
        station_candidates,
        subway_line_features,
    )
    station_access_points_geojson = _build_station_access_feature_collection(
        station_candidates,
        station_access_points,
        walk_graph,
    )
    lines_geojson = {"type": "FeatureCollection", "features": subway_line_features}

    output_dir.mkdir(parents=True, exist_ok=True)
    _write_geojson(output_dir / "stations.geojson", stations_geojson)
    _write_geojson(output_dir / "lines.geojson", lines_geojson)
    _write_geojson(output_dir / "station_access_points.geojson", station_access_points_geojson)
    _write_geojson(output_dir / "walk_network.geojson", walk_network_geojson)

    return {
        "stations": len(stations_geojson["features"]),
        "station_access_points": len(station_access_points_geojson["features"]),
        "lines": len(lines_geojson["features"]),
        "walk_network": len(walk_network_geojson["features"]),
    }


def iter_geojson_features(path: Path):
    if not path.exists():
        raise FileNotFoundError(path)

    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or '"type": "Feature"' not in line:
                continue
            candidate = line.rstrip(",")
            yield json.loads(candidate)


def _collect_station_points(
    feature: dict[str, Any],
    network_station_lookup: dict[str, dict[str, Any]],
    station_candidates: dict[str, list[dict[str, Any]]],
    station_access_points: dict[str, list[dict[str, Any]]],
) -> None:
    props = feature.get("properties", {}) or {}
    tags = parse_other_tags(props.get("other_tags"))
    railway = (tags.get("railway") or props.get("railway") or "").lower()
    public_transport = (tags.get("public_transport") or props.get("public_transport") or "").lower()
    if railway not in {"station", "stop", "subway_entrance"} and public_transport not in {"station", "stop_position"} and tags.get("subway") != "yes":
        return

    station_id = _match_station_id(feature, network_station_lookup)
    if station_id is None:
        return

    coordinates = feature.get("geometry", {}).get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return

    record = {
        "coordinate": (float(coordinates[0]), float(coordinates[1])),
        "name": props.get("name") or tags.get("name:en") or tags.get("name:zh"),
        "tags": tags,
    }

    if railway == "subway_entrance":
        station_access_points.setdefault(station_id, []).append(record)
        return

    station_candidates.setdefault(station_id, []).append(record)


def _build_station_feature_collection(
    network_station_by_id: dict[str, dict[str, Any]],
    station_candidates: dict[str, list[dict[str, Any]]],
    line_features: list[dict[str, Any]],
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    line_segments_by_id = _build_line_segment_index(line_features)
    for station_id, records in sorted(station_candidates.items()):
        if not records:
            continue
        lon = sum(record["coordinate"][0] for record in records) / len(records)
        lat = sum(record["coordinate"][1] for record in records) / len(records)
        station = network_station_by_id[station_id]
        lon, lat = _snap_station_coordinate_to_lines(
            (lon, lat),
            station["line_ids"],
            line_segments_by_id,
        )
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                "properties": {
                    "id": station_id,
                    "name": station["name"],
                    "line_ids": station["line_ids"],
                    "source": "taipei_geojson",
                },
            }
        )

    return {"type": "FeatureCollection", "features": features}


def _build_station_access_feature_collection(
    station_candidates: dict[str, list[dict[str, Any]]],
    station_access_points: dict[str, list[dict[str, Any]]],
    walk_graph,
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for station_id in sorted(set(station_candidates) | set(station_access_points)):
        records = station_access_points.get(station_id) or station_candidates.get(station_id) or []
        for index, record in enumerate(records, start=1):
            snapped_lon, snapped_lat = _snap_to_walk_node(walk_graph, record["coordinate"])
            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(snapped_lon, 7), round(snapped_lat, 7)],
                    },
                    "properties": {
                        "station_id": station_id,
                        "name": record["name"] or f"Access {index}",
                    },
                }
            )

    return {"type": "FeatureCollection", "features": features}


def _match_station_id(
    feature: dict[str, Any],
    network_station_lookup: dict[str, dict[str, Any]],
) -> str | None:
    for candidate in station_name_candidates(feature):
        normalized_candidate = normalize_station_name(candidate)
        station = network_station_lookup.get(normalized_candidate)
        if station is not None:
            return station["id"]
    return None


def _load_network_station_lookup(
    network_path: Path | None,
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
]:
    if network_path is None or not network_path.exists():
        return {}, {}, {}

    payload = json.loads(network_path.read_text(encoding="utf-8"))
    line_lookup = {line["id"]: line for line in payload.get("lines", [])}
    station_to_lines: dict[str, list[str]] = {}
    for station_line in payload.get("station_lines", []):
        station_to_lines.setdefault(station_line["station_id"], []).append(station_line["line_id"])

    lookup: dict[str, dict[str, Any]] = {}
    by_id: dict[str, dict[str, Any]] = {}
    for station in payload.get("stations", []):
        station_record = {
            "id": station["id"],
            "name": station["name"],
            "line_ids": sorted(set(station_to_lines.get(station["id"], []))),
            "line_names": [
                line_lookup[line_id]["name"]
                for line_id in sorted(set(station_to_lines.get(station["id"], [])))
                if line_id in line_lookup
            ],
        }
        normalized_name = normalize_station_name(station["name"])
        lookup[normalized_name] = station_record
        by_id[station["id"]] = station_record
    return lookup, by_id, line_lookup


def _to_subway_line_feature(
    feature: dict[str, Any],
    network_line_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    props = feature.get("properties", {}) or {}
    tags = parse_other_tags(props.get("other_tags"))
    line_name = tags.get("name:en") or props.get("name") or tags.get("name")
    line_color = _normalize_color(tags.get("colour"))
    line_id = _infer_network_line_id(
        route_type=tags.get("route"),
        ref=tags.get("ref"),
        network=tags.get("network") or tags.get("network:en"),
        line_name=line_name,
        line_color=line_color,
    )
    if line_id and network_line_by_id.get(line_id, {}).get("color"):
        line_color = network_line_by_id[line_id]["color"]
    return {
        "type": "Feature",
        "geometry": feature.get("geometry"),
        "properties": {
            "line_id": line_id,
            "line_ref": tags.get("ref"),
            "line_name": line_name,
            "line_color": line_color,
            "network": tags.get("network") or tags.get("network:en"),
            "osm_id": props.get("osm_id"),
        },
    }


def _to_walk_network_feature(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties", {}) or {}
    return {
        "type": "Feature",
        "geometry": feature.get("geometry"),
        "properties": {
            "name": props.get("name"),
            "highway": props.get("highway"),
        },
    }


def _normalize_color(value: str | None) -> str:
    if not value:
        return "#637081"
    normalized = value.strip().lower()
    if normalized in {"red", "orange", "green", "blue", "brown", "yellow", "pink", "purple"}:
        return {
            "red": "#d12d3f",
            "orange": "#f2a23a",
            "green": "#1e7b54",
            "blue": "#007ec7",
            "brown": "#a74c00",
            "yellow": "#f0c419",
            "pink": "#f4a5a8",
            "purple": "#8b6bbd",
        }[normalized]
    if normalized.startswith("#"):
        return normalized
    return "#637081"


def _infer_network_line_id(
    *,
    route_type: str | None,
    ref: str | None,
    network: str | None,
    line_name: str | None,
    line_color: str | None,
) -> str | None:
    route_type_value = (route_type or "").strip().lower()
    ref_value = (ref or "").strip().lower()
    raw_ref = ref or ""
    line_name_value = (line_name or "").strip().lower()
    raw_line_name = line_name or ""
    raw_network = network or ""
    line_color_value = (line_color or "").strip().lower()

    if route_type_value == "tram":
        if "maokong" in line_name_value or "貓空纜車" in raw_line_name or "貓空纜車" in (ref or ""):
            return "c0"
        return None

    if route_type_value == "light_rail":
        if ref_value == "k" or "ankeng" in line_name_value or "新北捷運" in raw_network:
            return "c10"
        if ref_value == "v" or "danhai" in line_name_value or "淡海" in raw_network:
            return "c7"
        return None

    if route_type_value != "subway":
        return None

    if "新北投" in raw_ref or "xinbeitou" in ref_value:
        return "c6"
    if "小碧潭" in raw_ref or "xiaobitan" in ref_value:
        return "c8"
    if ref_value == "br":
        return "c1"
    if ref_value == "r":
        if "xinbeitou" in line_name_value or "新北投" in raw_line_name or line_color_value == "#f890a5":
            return "c6"
        return "c2"
    if ref_value == "bl":
        return "c3"
    if ref_value == "g":
        if (
            "xiaobitan" in line_name_value
            or "小碧潭" in raw_line_name
            or line_color_value in {"#cedc00", "#dae11f"}
        ):
            return "c8"
        return "c4"
    if ref_value == "o":
        return "c5"
    if ref_value == "y":
        return "c9"
    if ref_value == "a":
        return "c11"
    return None


def _build_line_segment_index(
    line_features: list[dict[str, Any]],
) -> dict[str, list[tuple[tuple[float, float], tuple[float, float]]]]:
    segments_by_id: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]] = {}
    for feature in line_features:
        properties = feature.get("properties", {}) or {}
        line_id = properties.get("line_id")
        if not line_id:
            continue
        segments_by_id.setdefault(str(line_id), []).extend(_extract_line_segments(feature.get("geometry")))
    return segments_by_id


def _extract_line_segments(
    geometry: dict[str, Any] | None,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    if not isinstance(geometry, dict):
        return []
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString":
        return _pair_line_coordinates(coordinates)
    if geometry_type == "MultiLineString":
        segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
        for line_coordinates in coordinates or []:
            segments.extend(_pair_line_coordinates(line_coordinates))
        return segments
    return []


def _pair_line_coordinates(
    coordinates: list[Any] | None,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    if not isinstance(coordinates, list):
        return []

    points: list[tuple[float, float]] = []
    for coordinate in coordinates:
        if not isinstance(coordinate, list) or len(coordinate) < 2:
            continue
        points.append((float(coordinate[0]), float(coordinate[1])))

    return [(points[index], points[index + 1]) for index in range(len(points) - 1)]


def _snap_station_coordinate_to_lines(
    coordinate: tuple[float, float],
    line_ids: list[str],
    line_segments_by_id: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]],
) -> tuple[float, float]:
    best_coordinate: tuple[float, float] | None = None
    best_distance_m: float | None = None
    for line_id in line_ids:
        for segment_start, segment_end in line_segments_by_id.get(line_id, []):
            projected_coordinate, distance_m = _project_coordinate_to_segment(
                coordinate,
                segment_start,
                segment_end,
            )
            if best_distance_m is None or distance_m < best_distance_m:
                best_coordinate = projected_coordinate
                best_distance_m = distance_m

    if best_coordinate is None or best_distance_m is None or best_distance_m > STATION_SNAP_DISTANCE_METERS:
        return coordinate
    return best_coordinate


def _project_coordinate_to_segment(
    coordinate: tuple[float, float],
    segment_start: tuple[float, float],
    segment_end: tuple[float, float],
) -> tuple[tuple[float, float], float]:
    point_lon, point_lat = coordinate
    start_lon, start_lat = segment_start
    end_lon, end_lat = segment_end
    mid_lat = (point_lat + start_lat + end_lat) / 3
    meters_per_degree_lon = 111320.0 * math.cos(math.radians(mid_lat))
    meters_per_degree_lat = 111320.0

    point_x = point_lon * meters_per_degree_lon
    point_y = point_lat * meters_per_degree_lat
    start_x = start_lon * meters_per_degree_lon
    start_y = start_lat * meters_per_degree_lat
    end_x = end_lon * meters_per_degree_lon
    end_y = end_lat * meters_per_degree_lat

    segment_dx = end_x - start_x
    segment_dy = end_y - start_y
    segment_length_sq = segment_dx * segment_dx + segment_dy * segment_dy
    if segment_length_sq <= 1e-12:
        return segment_start, math.hypot(point_x - start_x, point_y - start_y)

    projection = ((point_x - start_x) * segment_dx + (point_y - start_y) * segment_dy) / segment_length_sq
    projection = max(0.0, min(1.0, projection))
    projected_lon = start_lon + (end_lon - start_lon) * projection
    projected_lat = start_lat + (end_lat - start_lat) * projection
    projected_x = start_x + segment_dx * projection
    projected_y = start_y + segment_dy * projection
    distance_m = math.hypot(point_x - projected_x, point_y - projected_y)
    return (projected_lon, projected_lat), distance_m


def _snap_to_walk_node(walk_graph, coordinate: tuple[float, float]) -> tuple[float, float]:
    if not getattr(walk_graph, "adjacency", None):
        return coordinate
    return walk_graph.nearest_node(*coordinate)


def _write_geojson(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

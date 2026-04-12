from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from statistics import median

from app.config import get_settings
from app.domain.models import Segment
from app.domain.models import SubwayNetwork
from app.services.gis_route_geometry import _build_geojson_segment_index
from app.services.route_engine import RouteEngine
from app.services.subway_loader import NetworkBuildOptions
from app.services.subway_loader import load_json_file
from app.services.subway_loader import load_network_from_dict
from app.services.subway_loader import load_station_positions_file
from app.services.subway_loader import merge_network_enrichment
from app.services.admin_scenarios import (
    load_admin_scenarios,
    build_admin_scenario_effects,
    apply_admin_scenarios_to_network,
)



def get_network():
    settings = get_settings()
    source_path = settings.data_file
    positions_path = settings.station_positions_file if settings.station_positions_file.exists() else None
    enrichment_path = settings.osm_enrichment_file if settings.osm_enrichment_file.exists() else None
    signature = _build_signature(
        source_path,
        positions_path,
        enrichment_path,
        settings.qgis_geojson_dir,
    )

    return _load_network_cached(
        str(source_path),
        str(positions_path) if positions_path else "",
        str(enrichment_path) if enrichment_path else "",
        str(settings.qgis_geojson_dir),
        str(settings.admin_scenarios_file),
        settings.map_width,
        settings.map_height,
        (
            settings.fallback_min_lon,
            settings.fallback_min_lat,
            settings.fallback_max_lon,
            settings.fallback_max_lat,
        ),
        settings.default_transfer_sec,

        settings.auto_walk_transfer_radius,
        settings.auto_walk_seconds_per_unit,
        signature,
    )



@lru_cache(maxsize=4)
def _load_network_cached(
    source_path: str,
    positions_path: str,
    enrichment_path: str,
    qgis_geojson_dir: str,
    admin_scenarios_path: str,
    map_width: float,
    map_height: float,
    fallback_bounds: tuple[float, float, float, float],
    default_transfer_sec: int,

    auto_walk_transfer_radius: float,
    auto_walk_seconds_per_unit: float,
    signature: str,
):

    del signature
    options = NetworkBuildOptions(
        station_positions=load_station_positions_file(positions_path or None),
        default_transfer_sec=default_transfer_sec,
        auto_walk_transfer_radius=auto_walk_transfer_radius,
        auto_walk_seconds_per_unit=auto_walk_seconds_per_unit,
    )
    raw_network = load_json_file(source_path)
    enrichment = load_json_file(enrichment_path or None)
    network = load_network_from_dict(
        merge_network_enrichment(raw_network, enrichment),
        options=options,
    )
    _supplement_segments_from_gis(network, Path(qgis_geojson_dir))

    # Apply admin scenarios (e.g., blocked stations, rain zones)
    # We need to build a temporary GIS payload to calculate effects
    from app.services.gis_loader import build_gis_payload
    gis_payload = build_gis_payload(
        network=network,
        qgis_geojson_dir=Path(qgis_geojson_dir),
        map_width=map_width,
        map_height=map_height,
        fallback_bounds=fallback_bounds,
        include_walk_network=False,
    )

    scenarios = load_admin_scenarios(admin_scenarios_path)
    effects = build_admin_scenario_effects(
        network=network,
        gis_payload=gis_payload,
        scenarios=scenarios,
    )
    network = apply_admin_scenarios_to_network(network, effects)

    return network



def get_route_engine() -> RouteEngine:
    settings = get_settings()
    source_path = settings.data_file
    positions_path = settings.station_positions_file if settings.station_positions_file.exists() else None
    enrichment_path = settings.osm_enrichment_file if settings.osm_enrichment_file.exists() else None
    signature = _build_signature(
        source_path,
        positions_path,
        enrichment_path,
        settings.qgis_geojson_dir,
    )

    return _load_route_engine_cached(
        str(source_path),
        str(positions_path) if positions_path else "",
        str(enrichment_path) if enrichment_path else "",
        str(settings.qgis_geojson_dir),
        str(settings.admin_scenarios_file),
        settings.map_width,
        settings.map_height,
        (
            settings.fallback_min_lon,
            settings.fallback_min_lat,
            settings.fallback_max_lon,
            settings.fallback_max_lat,
        ),
        settings.default_transfer_sec,

        settings.auto_walk_transfer_radius,
        settings.auto_walk_seconds_per_unit,
        signature,
    )



@lru_cache(maxsize=4)
def _load_route_engine_cached(
    source_path: str,
    positions_path: str,
    enrichment_path: str,
    qgis_geojson_dir: str,
    admin_scenarios_path: str,
    map_width: float,
    map_height: float,
    fallback_bounds: tuple[float, float, float, float],
    default_transfer_sec: int,

    auto_walk_transfer_radius: float,
    auto_walk_seconds_per_unit: float,
    signature: str,
) -> RouteEngine:

    network = _load_network_cached(
        source_path,
        positions_path,
        enrichment_path,
        qgis_geojson_dir,
        admin_scenarios_path,
        map_width,
        map_height,
        fallback_bounds,
        default_transfer_sec,

        auto_walk_transfer_radius,
        auto_walk_seconds_per_unit,
        signature,
    )

    return RouteEngine(network)


def refresh_runtime_caches() -> None:
    _load_network_cached.cache_clear()
    _load_route_engine_cached.cache_clear()


def _build_signature(
    source_path: Path,
    positions_path: Path | None,
    enrichment_path: Path | None,
    qgis_geojson_dir: Path,
) -> str:
    parts = [_path_signature(source_path)]
    if positions_path is not None:
        parts.append(_path_signature(positions_path))
    if enrichment_path is not None:
        parts.append(_path_signature(enrichment_path))
    parts.append(_path_signature(qgis_geojson_dir / "stations.geojson"))
    parts.append(_path_signature(qgis_geojson_dir / "lines.geojson"))
    
    settings = get_settings()
    parts.append(_path_signature(settings.admin_scenarios_file))

    return "|".join(parts)



def _path_signature(path: Path) -> str:
    if not path.exists():
        return f"{path}:missing"
    stat = path.stat()
    return f"{path}:{stat.st_size}:{stat.st_mtime_ns}"


def _supplement_segments_from_gis(network: SubwayNetwork, qgis_geojson_dir: Path) -> None:
    stations_geojson = load_json_file(qgis_geojson_dir / "stations.geojson")
    lines_geojson = load_json_file(qgis_geojson_dir / "lines.geojson")
    if not stations_geojson or not lines_geojson:
        return

    segment_index = _build_geojson_segment_index(stations_geojson, lines_geojson)
    if not segment_index:
        return

    existing_pairs = {
        (segment.line_id, segment.from_station_id, segment.to_station_id)
        for segment in network.segments
    }
    station_seq_by_line = {
        (station_line.line_id, station_line.station_id): int(station_line.seq)
        for station_line in network.station_lines
    }
    default_travel_sec_by_line = _default_travel_sec_by_line(network)

    for line_id, from_station_id, to_station_id in segment_index:
        from_seq = station_seq_by_line.get((line_id, from_station_id))
        to_seq = station_seq_by_line.get((line_id, to_station_id))
        if from_seq is None or to_seq is None or abs(from_seq - to_seq) != 1:
            continue

        forward_key = (line_id, from_station_id, to_station_id)
        reverse_key = (line_id, to_station_id, from_station_id)
        if forward_key in existing_pairs or reverse_key in existing_pairs:
            continue

        network.segments.append(
            Segment(
                line_id=line_id,
                from_station_id=from_station_id,
                to_station_id=to_station_id,
                travel_sec=default_travel_sec_by_line.get(line_id, 60),
            )
        )
        existing_pairs.add(forward_key)


def _default_travel_sec_by_line(network: SubwayNetwork) -> dict[str, int]:
    durations_by_line: dict[str, list[int]] = {}
    for segment in network.segments:
        durations_by_line.setdefault(segment.line_id, []).append(int(segment.travel_sec))

    return {
        line_id: max(1, int(round(median(durations))))
        for line_id, durations in durations_by_line.items()
        if durations
    }

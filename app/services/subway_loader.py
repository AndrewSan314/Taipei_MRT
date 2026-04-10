from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from app.domain.models import Line
from app.domain.models import Segment
from app.domain.models import Station
from app.domain.models import StationLine
from app.domain.models import Stop
from app.domain.models import SubwayNetwork
from app.domain.models import Transfer
from app.domain.models import WalkTransfer


@dataclass(frozen=True)
class NetworkBuildOptions:
    station_positions: dict[str, tuple[float, float]] = field(default_factory=dict)
    default_transfer_sec: int = 180
    auto_walk_transfer_radius: float = 0.0
    auto_walk_seconds_per_unit: float = 1.0


def load_json_file(path: str | Path | None) -> dict:
    if path is None:
        return {}

    file_path = Path(path)
    if not file_path.exists():
        return {}

    with file_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_station_positions_file(path: str | Path | None) -> dict[str, tuple[float, float]]:
    payload = load_json_file(path)
    if not payload:
        return {}
    if isinstance(payload, dict) and "stations" in payload:
        return {
            station["id"]: (float(station["x"]), float(station["y"]))
            for station in payload.get("stations", [])
            if "x" in station and "y" in station
        }
    if isinstance(payload, dict):
        return {
            station_id: (float(coords["x"]), float(coords["y"]))
            for station_id, coords in payload.items()
            if isinstance(coords, dict) and "x" in coords and "y" in coords
        }
    return {}


def merge_network_enrichment(raw: dict, enrichment: dict | None) -> dict:
    if not enrichment:
        return dict(raw)

    merged = dict(raw)
    merged["stops"] = _merge_stops(raw.get("stops", []), enrichment.get("stops", []))
    merged["walk_transfers"] = _merge_walk_transfer_dicts(
        raw.get("walk_transfers", []),
        enrichment.get("walk_transfers", []),
    )

    metadata = dict(raw.get("metadata", {}))
    metadata.update(enrichment.get("metadata", {}))
    if metadata:
        merged["metadata"] = metadata

    return merged


def build_station_transfers(
    station_to_lines: dict[str, set[str]],
    explicit_transfers: list[Transfer],
    default_transfer_sec: int,
) -> list[Transfer]:
    merged = {
        (transfer.station_id, transfer.from_line_id, transfer.to_line_id): transfer
        for transfer in explicit_transfers
    }

    for station_id, line_ids in station_to_lines.items():
        ordered_line_ids = sorted(line_ids)
        for from_line_id in ordered_line_ids:
            for to_line_id in ordered_line_ids:
                if from_line_id == to_line_id:
                    continue
                key = (station_id, from_line_id, to_line_id)
                if key in merged:
                    continue
                merged[key] = Transfer(
                    station_id=station_id,
                    from_line_id=from_line_id,
                    to_line_id=to_line_id,
                    transfer_sec=default_transfer_sec,
                )

    return list(merged.values())


def dedupe_walk_transfers(walk_transfers: list[WalkTransfer]) -> list[WalkTransfer]:
    deduped: dict[tuple[str, str], WalkTransfer] = {}

    for transfer in walk_transfers:
        key = (transfer.from_station_id, transfer.to_station_id)
        existing = deduped.get(key)
        if existing is None or transfer.duration_sec < existing.duration_sec:
            deduped[key] = transfer

    return list(deduped.values())


def build_walk_transfers(
    stations: dict[str, Station],
    station_to_lines: dict[str, set[str]],
    existing_walk_transfers: list[WalkTransfer],
    radius: float,
    seconds_per_unit: float,
) -> list[WalkTransfer]:
    if radius <= 0:
        return dedupe_walk_transfers(existing_walk_transfers)

    walk_transfers = list(existing_walk_transfers)
    existing_pairs = {
        (transfer.from_station_id, transfer.to_station_id)
        for transfer in existing_walk_transfers
    }
    station_ids = sorted(stations)

    for index, from_station_id in enumerate(station_ids):
        for to_station_id in station_ids[index + 1 :]:
            if station_to_lines[from_station_id] & station_to_lines[to_station_id]:
                continue

            distance = math.hypot(
                stations[from_station_id].x - stations[to_station_id].x,
                stations[from_station_id].y - stations[to_station_id].y,
            )
            if distance > radius:
                continue

            duration_sec = max(1, int(round(distance * seconds_per_unit)))
            for source_station_id, target_station_id in (
                (from_station_id, to_station_id),
                (to_station_id, from_station_id),
            ):
                if (source_station_id, target_station_id) in existing_pairs:
                    continue
                walk_transfers.append(
                    WalkTransfer(
                        from_station_id=source_station_id,
                        to_station_id=target_station_id,
                        duration_sec=duration_sec,
                    )
                )

    return dedupe_walk_transfers(walk_transfers)


def load_network_from_dict(
    raw: dict,
    options: NetworkBuildOptions | None = None,
) -> SubwayNetwork:
    options = options or NetworkBuildOptions()

    stations = {
        item["id"]: _build_station(item, options.station_positions)
        for item in raw["stations"]
    }
    stops = {
        item["id"]: Stop(
            id=item["id"],
            station_id=item.get("station_id", item["id"]),
            name=item["name"],
            latitude=float(item.get("latitude", item.get("y", 0.0))),
            longitude=float(item.get("longitude", item.get("x", 0.0))),
            line_id=item.get("line_id"),
        )
        for item in raw.get("stops", [])
    }
    lines = {
        item["id"]: Line(
            id=item["id"],
            name=item["name"],
            color=item["color"],
        )
        for item in raw["lines"]
    }
    station_lines = [
        StationLine(
            station_id=item["station_id"],
            line_id=item["line_id"],
            seq=item["seq"],
        )
        for item in raw["station_lines"]
    ]
    segments = [
        Segment(
            line_id=item["line_id"],
            from_station_id=item["from_station_id"],
            to_station_id=item["to_station_id"],
            travel_sec=item["travel_sec"],
        )
        for item in raw["segments"]
    ]
    explicit_transfers = [
        Transfer(
            station_id=item["station_id"],
            from_line_id=item["from_line_id"],
            to_line_id=item["to_line_id"],
            transfer_sec=item["transfer_sec"],
        )
        for item in raw["transfers"]
    ]
    explicit_walk_transfers = [
        WalkTransfer(
            from_station_id=item["from_station_id"],
            to_station_id=item["to_station_id"],
            duration_sec=item["duration_sec"],
        )
        for item in raw.get("walk_transfers", [])
    ]

    station_to_lines: dict[str, set[str]] = {}
    for station_line in station_lines:
        station_to_lines.setdefault(station_line.station_id, set()).add(station_line.line_id)

    transfers = build_station_transfers(
        station_to_lines,
        explicit_transfers,
        options.default_transfer_sec,
    )
    walk_transfers = build_walk_transfers(
        stations,
        station_to_lines,
        explicit_walk_transfers,
        options.auto_walk_transfer_radius,
        options.auto_walk_seconds_per_unit,
    )

    return SubwayNetwork(
        stations=stations,
        lines=lines,
        station_lines=station_lines,
        segments=segments,
        transfers=transfers,
        stops=stops,
        walk_transfers=walk_transfers,
        station_to_lines=station_to_lines,
        metadata=dict(raw.get("metadata", {})),
    )


def load_network_from_file(
    path: str | Path,
    options: NetworkBuildOptions | None = None,
) -> SubwayNetwork:
    return load_network_from_dict(load_json_file(path), options=options)


def _build_station(
    raw_station: dict,
    station_positions: dict[str, tuple[float, float]],
) -> Station:
    x, y = station_positions.get(
        raw_station["id"],
        (float(raw_station["x"]), float(raw_station["y"])),
    )
    return Station(
        id=raw_station["id"],
        name=raw_station["name"],
        x=x,
        y=y,
        diagram_x=float(raw_station["diagram_x"]) if "diagram_x" in raw_station else None,
        diagram_y=float(raw_station["diagram_y"]) if "diagram_y" in raw_station else None,
    )


def _merge_stops(base_stops: list[dict], overlay_stops: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {
        item["id"]: dict(item)
        for item in base_stops
        if isinstance(item, dict) and "id" in item
    }

    for item in overlay_stops:
        if not isinstance(item, dict) or "id" not in item:
            continue
        merged[item["id"]] = dict(item)

    return list(merged.values())


def _merge_walk_transfer_dicts(
    base_transfers: list[dict],
    overlay_transfers: list[dict],
) -> list[dict]:
    merged: dict[tuple[str, str], dict] = {}

    for item in base_transfers:
        if not _is_walk_transfer_dict(item):
            continue
        merged[(item["from_station_id"], item["to_station_id"])] = dict(item)

    for item in overlay_transfers:
        if not _is_walk_transfer_dict(item):
            continue
        merged[(item["from_station_id"], item["to_station_id"])] = dict(item)

    return list(merged.values())


def _is_walk_transfer_dict(item: dict) -> bool:
    return (
        isinstance(item, dict)
        and "from_station_id" in item
        and "to_station_id" in item
        and "duration_sec" in item
    )

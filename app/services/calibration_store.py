from __future__ import annotations

import json
from pathlib import Path


def save_station_positions(path: str | Path, positions: dict[str, dict[str, float]]) -> int:
    file_path = Path(path)
    if file_path.exists():
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    else:
        payload = {}

    if isinstance(payload, dict) and "stations" in payload:
        updated_count = 0
        for station in payload.get("stations", []):
            station_id = station["id"]
            if station_id not in positions:
                continue

            station["x"] = positions[station_id]["x"]
            station["y"] = positions[station_id]["y"]
            updated_count += 1
    else:
        existing_positions = payload if isinstance(payload, dict) else {}
        updated_count = len(positions)
        payload = {
            **existing_positions,
            **positions,
        }

    file_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return updated_count

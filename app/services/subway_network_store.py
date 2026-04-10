from __future__ import annotations

import json
from pathlib import Path


def load_network_definition(path: str | Path) -> dict:
    file_path = Path(path)
    return json.loads(file_path.read_text(encoding="utf-8"))


def save_network_definition(path: str | Path, payload: dict) -> dict[str, int]:
    file_path = Path(path)
    file_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "stations": len(payload.get("stations", [])),
        "lines": len(payload.get("lines", [])),
        "station_lines": len(payload.get("station_lines", [])),
        "segments": len(payload.get("segments", [])),
        "transfers": len(payload.get("transfers", [])),
    }

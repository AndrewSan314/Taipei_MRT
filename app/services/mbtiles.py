from __future__ import annotations

import sqlite3
from contextlib import closing
from functools import lru_cache
from pathlib import Path
from typing import Any


def get_mbtiles_metadata(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None

    metadata = _read_mbtiles_metadata(str(path), _path_signature(path))
    if metadata is None:
        return None
    return dict(metadata)


def read_mbtiles_tile(path: Path, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    metadata = get_mbtiles_metadata(path)
    if metadata is None:
        return None
    if min(z, x, y) < 0:
        return None

    tms_y = (1 << z) - 1 - y
    with closing(sqlite3.connect(path)) as connection:
        row = connection.execute(
            """
            SELECT tile_data
            FROM tiles
            WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?
            """,
            (z, x, tms_y),
        ).fetchone()

    if row is None:
        return None
    return bytes(row[0]), str(metadata["media_type"])


@lru_cache(maxsize=4)
def _read_mbtiles_metadata(path_str: str, signature: str) -> dict[str, Any] | None:
    del signature

    try:
        with closing(sqlite3.connect(path_str)) as connection:
            rows = connection.execute("SELECT name, value FROM metadata").fetchall()
    except sqlite3.Error:
        return None

    metadata_map = {
        str(name): str(value)
        for name, value in rows
    }
    tile_format = metadata_map.get("format", "").strip().lower()
    media_type = _media_type_for_format(tile_format)
    if media_type is None:
        return None

    minzoom = _safe_int(metadata_map.get("minzoom"), 0)
    maxzoom = _safe_int(metadata_map.get("maxzoom"), 22)

    return {
        "enabled": True,
        "type": "mbtiles_raster",
        "name": metadata_map.get("name") or Path(path_str).stem,
        "description": metadata_map.get("description", ""),
        "format": tile_format,
        "media_type": media_type,
        "tile_size": 256,
        "minzoom": minzoom,
        "maxzoom": max(maxzoom, minzoom),
        "bounds": _parse_bounds(metadata_map.get("bounds")),
    }


def _media_type_for_format(tile_format: str) -> str | None:
    return {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(tile_format)


def _parse_bounds(raw_value: str | None) -> list[float] | None:
    if not raw_value:
        return None

    parts = [part.strip() for part in raw_value.split(",")]
    if len(parts) != 4:
        return None

    try:
        return [float(part) for part in parts]
    except ValueError:
        return None


def _safe_int(raw_value: str | None, default: int) -> int:
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def _path_signature(path: Path) -> str:
    stat = path.stat()
    return f"{stat.st_size}:{stat.st_mtime_ns}"

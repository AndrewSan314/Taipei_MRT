from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import PROJECT_ROOT
from app.services.taipei_geojson_builder import build_taipei_gis_datasets


def main() -> None:
    raw_geojson_dir = PROJECT_ROOT / "taipei geojson"
    output_dir = PROJECT_ROOT / "app" / "data" / "gis"
    network_path = PROJECT_ROOT / "app" / "data" / "subway_network.json"

    result = build_taipei_gis_datasets(
        raw_geojson_dir=raw_geojson_dir,
        output_dir=output_dir,
        network_path=network_path,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

# Structure

## Root Directory
- `app/`: Main application source code.
- `docs/`: Documentation and project reports.
- `map/`: Raw geographical data and generated graph files.
- `scripts/`: Maintenance and utility scripts.
- `tests/`: Automated test suite.
- `README.md`: Project overview and setup instructions.
- `pyproject.toml`: Python dependency configuration.

## Application Structure (`app/`)
- `api/`: FastAPI route definitions.
- `domain/`: Business logic models and core entities.
- `services/`: Core service logic (routing, GIS loading, walk networks).
- `static/`: Frontend Javascript, CSS, and HTML assets.
- `data/`: Local storage for GeoJSON datasets and scenario metadata.
  - `gis/`: Core GIS data files.
  - `gis/.runtime-cache/`: Optimized, persistent pathfinding artifacts.

## Key Files
- `app/main.py`: Application entry point.
- `app/services/walk_network.py`: Pedestrian routing and walk-to-station logic.
- `app/services/route_engine.py`: Subway-to-subway routing engine.
- `scripts/build_gis_runtime_cache.py`: Pre-computation utility for system readiness.

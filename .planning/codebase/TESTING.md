# Testing

## Framework
- **Pytest**: Used for all automated tests.
- **Root Tests**: Found in the `tests/` directory.

## Coverage Areas
- **GIS Loading**: Verifies GeoJSON data parsing and validation.
- **Route Engine**: Testing Dijkstra accuracy for subway segment pathfinding.
- **Walk Network**: Verifies pedestrian graph construction and nearest-neighbor search.
- **Runtime Optimization**: Tests the creation and loading of cache artifacts (`gis_runtime_artifacts`).

## Key Test Files
- `tests/test_gis_loader.py`
- `tests/test_route_engine.py`
- `tests/test_gis_runtime_artifacts.py`

## State of Testing
- **Integration Tests**: Core routing logic is covered with specific coordinate-to-station scenarios.
- **Regression Tests**: Benchmarks exist to prevent performance regressions in the walk network.

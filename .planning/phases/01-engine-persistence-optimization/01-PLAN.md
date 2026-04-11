---
wave: 1
depends_on: []
files_modified:
  - app/services/walk_network.py
requirements:
  - R1.1
  - R1.2
  - R3.2
autonomous: true
---

# Plan 01.1: Engine Persistence Implementation

Implement binary caching for the `WalkGraph` to eliminate cold-start latency.

## Tasks

<task>
<read_first>
- app/services/walk_network.py
- app/config.py
</read_first>
<action>
Implement caching logic in `app/services/walk_network.py`:
1. Add `import pickle` and `import os`.
2. Define `_get_source_mtime(settings: Settings) -> float` to return the max mtime of files in `settings.qgis_geojson_dir`.
3. Implement `load_cache(settings: Settings) -> WalkGraph | None`:
    - Path: `settings.qgis_geojson_dir / ".cache" / "walk_graph.pkl"`
    - Verify cache exists and `os.path.getmtime(cache_path) >= _get_source_mtime(settings)`.
    - Load using `pickle.load()` with Protocol 5.
4. Implement `save_cache(settings: Settings, graph: WalkGraph)`:
    - Ensure `.cache` directory exists.
    - Write using `pickle.dump(graph, f, protocol=5)`.
5. Update `build_walk_graph` to try loading from cache first. If it fails or is stale, build it and then save the new graph to cache.
</action>
<acceptance_criteria>
- `walk_network.py` contains `load_cache` and `save_cache` functions.
- `build_walk_graph` calls `load_cache` at the start.
- A `.cache` folder is created in the GIS data directory after the first run.
</acceptance_criteria>
</task>

<task>
<read_first>
- app/services/walk_network.py
</read_first>
<action>
Create a benchmarking script `scratch/benchmark_startup.py` to measure `build_walk_graph` execution time.
It should:
- Run `build_walk_graph` once to warm the cache.
- Run it a second time and measure the duration.
- Print the duration in milliseconds.
</action>
<acceptance_criteria>
- `scratch/benchmark_startup.py` exists and runs without error.
- Output shows duration for cached load.
</acceptance_criteria>
</task>

<task>
<read_first>
- app/services/walk_network.py
</read_first>
<action>
Create a unit test `tests/test_cache_integrity.py` that:
1. Builds a `WalkGraph` manually.
2. Saves it to a temporary cache.
3. Loads it back.
4. Asserts that `loaded_graph.adjacency == original_graph.adjacency`.
5. Asserts that `loaded_graph.spatial_index == original_graph.spatial_index`.
</action>
<acceptance_criteria>
- `tests/test_cache_integrity.py` exists.
- Running `pytest tests/test_cache_integrity.py` passes.
</acceptance_criteria>
</task>

## Verification

### Automated
- `pytest tests/test_cache_integrity.py`
- `python scratch/benchmark_startup.py` (Target: <100ms)

### Manual
- Delete the `.cache` directory and restart the server; verify a new cache file is generated.
- Update a GeoJSON file timestamp (e.g., `touch`) and verify the cache is rebuilt on next start.

## must_haves
- [ ] Warm start latency < 100ms.
- [ ] Graph integrity (adjacency/spatial index) preserved.
- [ ] Cache invalidation working on source file modification.

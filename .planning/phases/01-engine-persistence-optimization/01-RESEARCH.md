# Phase 01: Engine Persistence - Research

**Phase Goal**: Eliminate cold-start latency by caching the pre-processed `WalkGraph` and its spatial index.

## Serialization Strategy

### Options
- **`pickle`**: 
    - **Pros**: Native Python, handles dataclasses automatically, very fast with Protocol 5+.
    - **Cons**: Security (only unpickle trusted data), fragile if class definitions change.
- **`msgpack`**: 
    - **Pros**: Fast, cross-language.
    - **Cons**: Doesn't handle Python objects/tuples natively as keys (needs complex serializers).
- **`marshal`**: 
    - **Pros**: Extremely fast.
    - **Cons**: Version-specific, not for long-term persistence, doesn't handle custom classes well.

### Recommendation
Use **`pickle` with Protocol 5**. Since the `WalkGraph` is a complex object with nested dicts of tuples (coordinates), `pickle` is the most reliable and performant choice.

## Cache Invalidation Strategy

The cache must be invalidated if the source data changes. we will monitor:
1. `app/data/gis/network_topology.json` (Primary graph source)
2. `app/data/gis/*.geojson` (Any other topological data if used)

**Logic**:
- Store the `max(mtime)` of all source files in the cache metadata or compare them at load time.
- If any source file `mtime > cache_mtime`, rebuild.

## Implementation Details

### Cache Path
`app/data/gis/.cache/walk_graph.pkl`

### Predicted Performance
- **Current Startup**: ~2-5 seconds (GeoJSON parsing + spatial index generation).
- **Target Startup**: <100ms (Pickle loading).

## Verification Plan (Dimension 8)
- Test script to measure `build_walk_graph` time with/without cache.
- Integrity check: Ensure `WalkGraph.adjacency` and `WalkGraph.spatial_index` are identical after load.
- Invalidation test: Modify a source file and verify the cache is re-indexed.

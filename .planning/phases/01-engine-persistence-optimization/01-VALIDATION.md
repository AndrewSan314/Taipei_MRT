# Phase 01: Engine Persistence - Validation Strategy

**Gathered**: 2026-04-11
**Status**: Initial

## 1. Domain Coverage (Dimension 1)
- **Graph Topology**: Adjacency list must be perfectly preserved.
- **Spatial Accuracy**: Nearest node lookups must returned identical results before and after caching.

## 2. Invalidation Edge Cases (Dimension 2)
- **Empty Cache**: Handle first run gracefully.
- **Corrupt Cache**: Rebuild if `pickle.load` fails.
- **Timestamp Precision**: Use `os.path.getmtime` which handles sub-second precision on Windows (NTFS).

## 3. Performance Thresholds (Dimension 5)
- **Cold start (Cached)**: < 100ms.
- **Cold start (Uncached)**: < 5000ms.
- **Memory Overhead**: Pickle loading should not increase Peak RSS significantly compared to manual building.

## 4. Integrity Checks (Dimension 8)
- **Verification Script**: `tests/check_graph_integrity.py`
    - Compare `WalkGraph` attributes.
    - Validate `spatial_index` keys and values.

# Requirements

This document tracks the detailed functional and technical requirements for the `Taipei_MRT` project, focusing on the current optimization and UI enhancement goals.

## 1. Engine Optimization (Cold-Start & Query Speed)

### R1.1 Persistent WalkGraph Cache
- **Goal**: Reduce server initialization time from seconds to milliseconds.
- **Requirement**: Implement a caching layer in `walk_network.py` that serializes the `WalkGraph` (including spatial index) to a local file.
- **Trigger**: Cache is invalidated if the source GeoJSON files are modified.
- **Technology**: Use `pickle` (version 6) or similar fast binary serialization.

### R1.2 Improved Snap-to-Graph Performance
- **Goal**: Minimize the overhead of "snapping" coordinates to the nearest graph node.
- **Requirement**: Optimize the `nearest_node` lookup using the existing spatial index or a more efficient KD-tree.

### R1.3 Algorithm Benchmark (A*)
- **Goal**: Verify if heuristic-based routing (A*) significantly outperforms Dijkstra for this MRT graph.
- **Requirement**: Implement an A* variation using haversine distance as the heuristic.

## 2. UI/GIS Enhancements

### R2.1 Animated Route Paths
- **Goal**: Provide visual feedback on the routing flow.
- **Requirement**: Implement a "drawing" animation for the route path when a result is returned.
- **Technology**: MapLibre GeoJSON source update strategy.

### R2.2 Premium Station Markers
- **Goal**: elevate the visual quality of the GIS studio.
- **Requirement**:
  - Custom SVG markers for stations.
  - Interactive hover/click states with station metadata tooltips.
  - Scale markers based on zoom level.

### R2.3 Performance Monitoring
- **Goal**: Ensure UI remains smooth during large path rendering.
- **Requirement**: Instrument the frontend with performance markers (Rendering vs. API latency).

## 3. Workflow & Maintenance

### R3.1 Execution Policy Fix
- **Requirement**: Provide clear instructions to the user to enable script execution (`Set-ExecutionPolicy`).

### R3.2 Automated Verification
- **Requirement**: Unit tests for the cache layer to ensure data integrity after deserialization.

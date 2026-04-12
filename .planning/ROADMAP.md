# Roadmap

## Milestone 1: Performance & Polish

Focus: Eliminate cold-start lag and elevate the GIS visual quality.

### Phase 1: Engine Persistence (Optimization)
- **Goal**: Implement binary caching for the `WalkGraph`.
- **Tasks**:
  - Research best `pickle` protocol for large dicts.
  - Implement `save_cache` and `load_cache` in `walk_network.py`.
  - Add cache invalidation based on GeoJSON file timestamps.
  - Verify speed gains (Target: <100ms startup).

### Phase 2: GIS Visual Excellence (UI)
- **Goal**: Add "wow" factors to the MapLibre studio.
- **Tasks**:
  - Implement animated GeoJSON route drawing.
  - Redesign station markers with custom SVG icons.
  - Add station metadata tooltips.

### Phase 3: Algorithm & Verification
- **Goal**: Future-proof the engine and ensure stability.
- **Tasks**:
  - Implement A* baseline.
  - Benchmark Dijkstra vs. A* on common Taipei routes.
  - Update `TESTING.md` with new optimization test cases.

### Phase 4: Admin Scenario Integration (End-to-End)
- **Goal**: Connect Admin Studio overrides to the routing engine.
- **Tasks**:
  - Implement `/api/admin/scenarios` (GET, PUT, DELETE).
  - Inject scenario effects into the `SubwayNetwork` loading process.
  - Invalidate caches when admin scenarios are modified.
  - Verify detour calculation in GIS studio.

## Future Milestones

- **Milestone 2**: Multi-modal integration (Buses, Ubike).
- **Milestone 3**: Personalization & User Accounts.

---
*Last updated: 2026-04-11*

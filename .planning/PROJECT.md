# Taipei MRT Subway Web

## What This Is

A Python-powered web application for subway routing and GIS visualization in Taipei. It uses a custom-built Dijkstra engine on an expanded station-line graph and integrates with MapLibre GL JS for interactive map displays.

## Core Value

Faster and more visually intuitive subway navigation through optimized pathfinding and high-fidelity GIS representation.

## Requirements

### Validated

- ✓ **Dijkstra Engine**: Functional pathfinding on the expanded MRT graph.
- ✓ **GIS Integration**: MapLibre GL JS studio for geographic visualization.
- ✓ **QGIS Pipeline**: Capability to ingest and use QGIS exports (EPSG:4326).

### Active

- [ ] **Cold Start Optimization**: Implement persistent caching for the `WalkGraph` and spatial index to eliminate indexing lag on server startup.
- [ ] **Path Animation**: Implement smooth, high-fidelity animated route paths in the GIS studio.
- [ ] **Premium Markers**: Redesign station markers for a professional, "premium" aesthetic.
- [ ] **Algorithm Update**: Research and implement A* or similar heuristic-based optimizations for faster routing queries.

### Out of Scope

- [Real-time Train Tracking]: Deferred — requires external API integration currently not available.
- [Legacy Diagram Rendering]: Only the new GIS-first approach is supported for new feature work.

## Context

- The project is in a **Brownfield** phase with an existing codebase mapping completed.
- Performance issues were noted regarding the initial pathfinding request latency.
- UI/UX enhancement is a primary goal for professional presentation.

## Constraints

- **Tech Stack**: FastAPI, Python 3.10+, MapLibre GL JS, GeoJSON.
- **Data Format**: EPSG:4326 lon/lat for all GIS coordinates.
- **Platforms**: Primary focus on modern web browsers.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GSD Adoption | Formalizing project management via the Get Shit Done framework. | — Pending |
| Persistent Caching | Using `pickle` for `WalkGraph` serialization to solve cold-start lag. | — Pending |

---
*Last updated: 2026-04-11 after initialization*

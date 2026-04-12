# IT3160 Subway Web

A professional Python web application for subway routing and GIS visualization. Built with **FastAPI** and a custom **Dijkstra** routing engine optimized for expanded station-line graphs.

## Core Features

- **Interactive GIS Studio**: WebGL-powered studio for smoother pan/zoom and precise GIS-ready integration.
- **Dijkstra Routing Engine**: Multi-modal route finding snapping points to the nearest MRT stations.
- **Admin Scenario Management**: Real-time scenario enforcement (blocked stations, rain zones) that propagates to the routing engine.
- **Hybrid Mapping**: Supports both semantic diagram surfaces and real-map SVG picking.

---

## Prerequisites

- **Python**: 3.12 or higher.
- **Dependencies**: 
  ```bash
  pip install fastapi uvicorn pydantic
  ```
  *(Or use the provided `pyproject.toml` for standardized dependency management)*

## Getting Started

### 1. Data Setup
Ensure that the following data files are present in `app/data/`:
- `gis/network_topology.json` (The base subway graph)
- `station_positions_taipei_vector_map_2022.json` (Station coordinate mapping)
- `subway_osm_enrichment.json` (Optional OSM data for transfers)

### 2. Pre-build GIS Artifacts
Before running the server, pre-build the GIS snapping cache to ensure fast routing:
```bash
python scripts\build_gis_runtime_cache.py
```

### 3. Run the Web Server
You can start the application using the helper scripts:
- **Windows Command Prompt**: `start_web.bat`
- **PowerShell**: `.\start_web.ps1`

Alternatively, run uvicorn manually:
```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

---

## Tools & Modules

- **GIS Studio**: `http://127.0.0.1:8010/` (Main entry)
- **Admin Panel**: `http://127.0.0.1:8010/admin` (Scenario management)
- **Calibration Tool**: `http://127.0.0.1:8010/calibrate` (Click exact station positions)
- **Graph Builder**: `http://127.0.0.1:8010/builder` (Rebuild subway graph on SVG)

## API Reference

- `GET /api/gis/network`: Returns the complete scenario-aware subway network.
- `POST /api/gis/route/points`: Calculates multi-modal routes for arbitrary map points.
- `GET /api/admin/scenarios`: Retrieves currently active scenario rules.

---

## Tests

Run the backend test suite using:
```bash
python -m unittest tests.test_route_engine -v
python -m unittest tests.test_api -v
```

# IT3160 Subway Web

Minimal Python web app for subway routing using FastAPI and a custom Dijkstra engine on an expanded station-line graph.

The frontend now uses:
- `map/geography/taipei-vector-map-2022.svg` for real-map point picking
- `map/diagram/taipei_mrt_interactive.svg` as the semantic subway diagram surface
- `/gis` MapLibre WebGL studio for smoother pan/zoom and GIS-ready integration

The interactive subway SVG is generated from the MetroMapMaker export by:

```powershell
python IT3160-SubwayWeb\scripts\map\normalize_metromapmaker_svg.py `
  --source IT3160-SubwayWeb\map\diagram\metromapmaker-8S4w6aZ4.svg `
  --output IT3160-SubwayWeb\map\diagram\taipei_mrt_interactive.svg `
  --mapping IT3160-SubwayWeb\app\data\taipei_mrt_interactive_map.json
```

## Structure

- `app/static/route-studio` contains the main demo page.
- `app/static/calibration` contains the calibration tool.
- `app/static/builder` contains the graph builder.
- `app/static/gis-studio` contains the GIS WebGL studio.
- `app/static/shared` contains shared UI shell styles.
- `docs/architecture` stores codebase structure docs.
- `docs/planning` stores task allocation and planning docs.
- `scripts/map` stores map and SVG normalization scripts.
- `map/geography` stores real-map assets.
- `map/diagram` stores semantic diagram assets.

Calibration tool:

```powershell
http://127.0.0.1:8010/calibrate
```

Use it to click the exact station positions on the image and save them back into `app/data/station_positions_taipei_vector_map_2022.json`.

Graph builder:

```powershell
http://127.0.0.1:8010/builder
```

Use it to rebuild the subway graph directly on top of the semantic SVG diagram.

GIS studio:

```powershell
http://127.0.0.1:8010/gis
```

`/api/gis/network` loads QGIS exports from `app/data/gis/stations.geojson` and
`app/data/gis/lines.geojson` when available (EPSG:4326). If missing, it falls back
to projected coordinates from legacy pixel data.

If `OUTPUT_FILE.mbtiles` exists at repo root, GIS studio uses it as the local raster
basemap. You can override that file path with `SUBWAY_GIS_MBTILES_FILE`.

GIS point routing:

- User can click any two points on map (not required to click stations).
- Backend snaps to nearest station, computes subway route, and returns access/egress walking legs.
- Endpoint: `POST /api/gis/route/points`

## Run

### Option 1: from repo root

```powershell
python -m uvicorn --app-dir IT3160-SubwayWeb app.main:app --host 127.0.0.1 --port 8010
```

### Option 2: from project folder

```powershell
cd IT3160-SubwayWeb
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Open `http://127.0.0.1:8010`.

If you see `WinError 10048`, the port is already in use. Pick another free port, or use the helper scripts below.

Helper scripts:

```powershell
.\IT3160-SubwayWeb\start_web.ps1
```

```cmd
IT3160-SubwayWeb\start_web.bat
```

Both helper scripts start from `8010` and automatically move to the next free port if needed.

## Tests

```powershell
python -m unittest IT3160-SubwayWeb.tests.test_route_engine -v
python -m unittest IT3160-SubwayWeb.tests.test_api -v
```

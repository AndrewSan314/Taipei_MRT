# Integrations

## Data Sources
- **QGIS GeoJSON**: Exported GIS data for stations, lines, and access points.
- **Walk Network (OSM)**: OpenStreetMap-based walk network data integrated via GeoJSON.
- **MBTiles**: High-resolution map tiles (`OUTPUT_FILE.mbtiles`).
- **OSM PBF**: Raw OpenStreetMap data for Taipei/Taiwan.

## API Integration
- **Internal Routing**: Integrates between walk networks and subway segment networks.
- **Runtime Cache**: Synchronous integration with local disk cache for pre-computed GIS artifacts.

## System Interfaces
- **PowerShell/Bash**: Automated server start scripts (`start_web.ps1`, `start_web.bat`).
- **Uvicorn/FastAPI**: REST API interface for frontend and external queries.

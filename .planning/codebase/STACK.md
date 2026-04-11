# Tech Stack

## Core
- **Python**: version 3.12+ (as per pyproject.toml)
- **FastAPI**: 0.115.0+ (Web framework)
- **Uvicorn**: 0.30.0+ (ASGI server)

## Data Processing & GIS
- **GeoJSON**: Major data interchange format for stations, lines, and walk networks.
- **Pickle**: Used for persistent caching of complex graph objects (`WalkGraph`).
- **hashlib (SHA-256)**: For data integrity and cache signature generation.
- **pathlib**: Modern path management across components.

## Pathfinding
- **Dijkstra**: (Custom implementation) Optimized with Early-Stop for walk network nearest-neighbor search.
- **NetworkX** (Implicit): While not in dependencies, the graph structure follows adjacency list patterns.

## Frontend
- **Vanilla Javascript/CSS**: High-performance UI logic.
- **Leaflet/Mapbox** (Contextual): Likely used for mapping visualizations.

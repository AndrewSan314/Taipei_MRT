# Concerns

## Technical Debt
- **Context Synchronization**: Logic between the root `app/` and the sub-folder `Taipei_MRT/app/` can drift if updates are only applied locally.
- **Manual Cache Warming**: The system requires running `build_gis_runtime_cache.py` for optimal performance after GIS data updates.

## Performance Risks
- **Memory Consumption**: Loading large Walk Graphs into memory can be expensive (hundreds of MBs). LRU caching helps but needs monitoring.
- **Graph Scalability**: As Taipei's walk network grows (higher resolution OSM data), the Dijkstra-based search, even with early-exit, may slow down without further spatial partitioning.

## Security
- **API Exposure**: Current endpoints accept raw coordinates; input sanitization and rate limiting should be considered for production deployment.
- **Serialization**: `pickle` is used for caching, which has security implications if cache files are tampered with (untrusted data deserialization).

## Operations
- **Windows Dependency**: Start scripts are optimized for Windows (PS1/BAT). Portability to Linux/Docker needs verification.
- **Data Integrity**: Significant reliance on static GeoJSON files being correctly formatted by external tools (QGIS).

# QGIS GIS Export Folder

Place QGIS exports in this folder to enable production-accurate GIS mode:

- `stations.geojson`
- `lines.geojson`

Requirements:

- CRS: `EPSG:4326` (WGS84 lon/lat)
- `stations.geojson` features must contain `properties.id` matching station ids in `app/data/subway_network.json`
- `lines.geojson` should contain `LineString` or `MultiLineString` features

When these files are missing, `/api/gis/network` automatically falls back to projected coordinates from legacy pixel data.

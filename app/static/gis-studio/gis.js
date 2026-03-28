const state = {
  network: null,
  gis: null,
  map: null,
  focusBounds: null,
  pickMode: "start",
  startPoint: null,
  endPoint: null,
  viaStationIds: [],
  routeResult: null,
  stationCoordsById: new Map(),
  stationById: new Map(),
  lineById: new Map(),
  suppressNextMapClick: false,
  stationEditMode: false,
  editableStationId: null,
  dirtyStationIds: new Set(),
  isDraggingStation: false,
  stationDragMoveHandler: null,
  stationDragUpHandler: null,
};

const elements = {
  gisSourceBadge: document.getElementById("gisSourceBadge"),
  pickStartBtn: document.getElementById("pickStartBtn"),
  pickEndBtn: document.getElementById("pickEndBtn"),
  pickViaBtn: document.getElementById("pickViaBtn"),
  clearViaBtn: document.getElementById("clearViaBtn"),
  findRouteBtn: document.getElementById("findRouteBtn"),
  resetBtn: document.getElementById("resetBtn"),
  toggleEditBtn: document.getElementById("toggleEditBtn"),
  deleteStationBtn: document.getElementById("deleteStationBtn"),
  saveStationsBtn: document.getElementById("saveStationsBtn"),
  reloadStationsBtn: document.getElementById("reloadStationsBtn"),
  statusText: document.getElementById("statusText"),
  selectionCard: document.getElementById("selectionCard"),
  editorCard: document.getElementById("editorCard"),
  summaryCard: document.getElementById("summaryCard"),
  stepsList: document.getElementById("stepsList"),
};

const SOURCE_IDS = {
  lines: "metro-lines",
  stations: "metro-stations",
  pickedPoints: "picked-points",
  selectedStations: "selected-stations",
  route: "route-lines",
};

async function init() {
  if (!window.maplibregl) {
    setStatus("MapLibre failed to load. Check internet/CDN access.");
    return;
  }

  try {
    const [networkResponse, gisResponse] = await Promise.all([
      fetch("/api/network"),
      fetch("/api/gis/network"),
    ]);
    state.network = await networkResponse.json();
    state.gis = await gisResponse.json();

    if (!networkResponse.ok || !gisResponse.ok) {
      throw new Error("Failed to load GIS API payload.");
    }

    state.lineById = new Map((state.network.lines || []).map((line) => [line.id, line]));
    state.stationById = new Map((state.network.stations || []).map((station) => [station.id, station]));
    buildStationCoordinateLookup();
    bindEvents();
    initializeMap();
    renderAll();

    const networkSourceLabel = state.gis.source?.startsWith("qgis_geojson")
      ? "QGIS GeoJSON"
      : "Fallback Projection";
    const baseMapLabel = state.gis.basemap?.enabled
      ? "MBTiles Raster"
      : "OSM Raster";
    elements.gisSourceBadge.textContent = `${networkSourceLabel} + ${baseMapLabel}`;
    setStatus(
      state.gis.source?.startsWith("qgis_geojson")
        ? state.gis.basemap?.enabled
          ? "GIS source loaded from QGIS export with local MBTiles basemap."
          : "GIS source loaded from QGIS export with OSM fallback basemap."
        : state.gis.basemap?.enabled
          ? "Fallback coordinates in use with local MBTiles basemap."
          : "Fallback coordinates in use. Put QGIS exports into app/data/gis for true geospatial accuracy.",
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to initialize GIS studio.");
  }
}

function buildStationCoordinateLookup() {
  state.stationCoordsById.clear();

  (state.gis.stations?.features || []).forEach((feature) => {
    const stationId = feature?.properties?.id;
    const coordinates = feature?.geometry?.coordinates;
    if (!stationId || !Array.isArray(coordinates) || coordinates.length < 2) {
      return;
    }
    state.stationCoordsById.set(stationId, [Number(coordinates[0]), Number(coordinates[1])]);
  });
}

function bindEvents() {
  elements.pickStartBtn.addEventListener("click", () => setPickMode("start"));
  elements.pickEndBtn.addEventListener("click", () => setPickMode("end"));
  elements.pickViaBtn.addEventListener("click", () => setPickMode("via"));
  elements.clearViaBtn.addEventListener("click", clearViaStations);
  elements.findRouteBtn.addEventListener("click", findRouteForPoints);
  elements.resetBtn.addEventListener("click", resetAll);
  elements.toggleEditBtn.addEventListener("click", toggleStationEditMode);
  elements.deleteStationBtn.addEventListener("click", deleteEditableStation);
  elements.saveStationsBtn.addEventListener("click", saveEditedStations);
  elements.reloadStationsBtn.addEventListener("click", reloadGisStations);
}

function isValidBounds(bounds) {
  return (
    Array.isArray(bounds) &&
    bounds.length === 4 &&
    bounds.every((value) => Number.isFinite(Number(value))) &&
    Number(bounds[0]) < Number(bounds[2]) &&
    Number(bounds[1]) < Number(bounds[3])
  );
}

function expandBounds(bounds, padding) {
  return [
    bounds[0] - padding,
    bounds[1] - padding,
    bounds[2] + padding,
    bounds[3] + padding,
  ];
}

function shrinkBounds(bounds, ratioX, ratioY) {
  if (!isValidBounds(bounds)) {
    return bounds;
  }

  const longitudeInset = (bounds[2] - bounds[0]) * ratioX;
  const latitudeInset = (bounds[3] - bounds[1]) * ratioY;
  const shrunk = [
    bounds[0] + longitudeInset,
    bounds[1] + latitudeInset,
    bounds[2] - longitudeInset,
    bounds[3] - latitudeInset,
  ];
  return isValidBounds(shrunk) ? shrunk : bounds;
}

function clampBounds(bounds, clampTo) {
  if (!isValidBounds(bounds) || !isValidBounds(clampTo)) {
    return bounds;
  }

  const clamped = [
    Math.max(bounds[0], clampTo[0]),
    Math.max(bounds[1], clampTo[1]),
    Math.min(bounds[2], clampTo[2]),
    Math.min(bounds[3], clampTo[3]),
  ];
  return isValidBounds(clamped) ? clamped : bounds;
}

function getPercentile(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || !sortedValues.length) {
    return null;
  }

  const scaledIndex = Math.min(Math.max(percentile, 0), 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.ceil(scaledIndex);
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const ratio = scaledIndex - lowerIndex;
  return sortedValues[lowerIndex] * (1 - ratio) + sortedValues[upperIndex] * ratio;
}

function getStationCoordinates() {
  return (state.gis?.stations?.features || [])
    .filter((feature) => !isDeletedStationFeature(feature))
    .map((feature) => feature?.geometry?.coordinates)
    .filter(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(Number(point[0])) &&
        Number.isFinite(Number(point[1])),
    )
    .map((point) => [Number(point[0]), Number(point[1])]);
}

function getStationCoordinateBounds() {
  const coordinates = getStationCoordinates();
  if (!coordinates.length) {
    return null;
  }

  const longitudes = coordinates.map(([lon]) => lon);
  const latitudes = coordinates.map(([, lat]) => lat);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function isPointWithinBounds(point, bounds) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    isValidBounds(bounds) &&
    Number(point[0]) >= bounds[0] &&
    Number(point[0]) <= bounds[2] &&
    Number(point[1]) >= bounds[1] &&
    Number(point[1]) <= bounds[3]
  );
}

function filterPointFeaturesToBounds(featureCollection, bounds) {
  if (!featureCollection?.features || !isValidBounds(bounds)) {
    return featureCollection;
  }

  return {
    ...featureCollection,
    features: featureCollection.features.filter(
      (feature) =>
        !isDeletedStationFeature(feature) &&
        isPointWithinBounds(feature?.geometry?.coordinates, bounds),
    ),
  };
}

function getInteractiveBounds() {
  const dataBounds = isValidBounds(state.gis?.bounds)
    ? expandBounds(state.gis.bounds.map(Number), 0.008)
    : expandBounds(getStationCoordinateBounds() || [121.45, 24.95, 121.65, 25.15], 0.008);
  const basemapBounds = isValidBounds(state.gis?.basemap?.bounds)
    ? state.gis.basemap.bounds.map(Number)
    : null;

  if (dataBounds && basemapBounds) {
    return clampBounds(dataBounds, basemapBounds);
  }
  return dataBounds || basemapBounds || [121.45, 24.95, 121.65, 25.15];
}

function getCurrentViewportBounds() {
  if (!state.map) {
    return null;
  }

  const bounds = state.map.getBounds();
  if (!bounds) {
    return null;
  }
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function getSourceBounds() {
  const basemapBounds = isValidBounds(state.gis?.basemap?.bounds)
    ? state.gis.basemap.bounds.map(Number)
    : null;
  return basemapBounds || getInteractiveBounds();
}

function getFocusBounds() {
  const coordinates = getStationCoordinates();
  if (coordinates.length < 12) {
    return getInteractiveBounds();
  }

  const longitudes = coordinates.map(([lon]) => lon).sort((left, right) => left - right);
  const latitudes = coordinates.map(([, lat]) => lat).sort((left, right) => left - right);
  const focusBounds = [
    getPercentile(longitudes, 0.11) - 0.0075,
    getPercentile(latitudes, 0.11) - 0.0075,
    getPercentile(longitudes, 0.91) + 0.013,
    getPercentile(latitudes, 0.91) + 0.013,
  ];

  return clampBounds(focusBounds, getInteractiveBounds());
}

function getStationViewportBounds() {
  const focusBounds = state.focusBounds || getFocusBounds();
  const viewportBounds = getCurrentViewportBounds();
  const baseBounds =
    isValidBounds(viewportBounds) && isValidBounds(focusBounds)
      ? clampBounds(viewportBounds, focusBounds)
      : viewportBounds || focusBounds;
  return shrinkBounds(baseBounds, 0.035, 0.06);
}

function getEnvelopeMinZoom(bounds) {
  if (!state.map || !isValidBounds(bounds)) {
    return 13.25;
  }

  const fitCamera = state.map.cameraForBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    {
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
      maxZoom: 22,
    },
  );
  const container = state.map.getContainer();
  const aspectRatio =
    container && container.clientWidth > 0 && container.clientHeight > 0
      ? container.clientWidth / container.clientHeight
      : 1;
  const zoomBias = aspectRatio >= 1.55 ? 0.14 : aspectRatio >= 1.35 ? 0.08 : 0.04;
  return Math.min((fitCamera?.zoom || 12.95) + zoomBias, 14.4);
}

function getDefaultViewportCamera(bounds, minZoom) {
  if (!isValidBounds(bounds)) {
    return {
      center: [121.54, 25.05],
      zoom: minZoom || 13.25,
      bearing: 0,
      pitch: 0,
    };
  }

  const container = state.map.getContainer();
  const aspectRatio =
    container && container.clientWidth > 0 && container.clientHeight > 0
      ? container.clientWidth / container.clientHeight
      : 1;
  const center = [
    (bounds[0] + bounds[2]) / 2 + (aspectRatio >= 1.45 ? 0.0012 : 0.0005),
    (bounds[1] + bounds[3]) / 2 + (aspectRatio >= 1.45 ? 0.0046 : 0.0025),
  ];

  return {
    center,
    zoom: minZoom,
    bearing: 0,
    pitch: 0,
  };
}

function refreshVisibleStationsSource() {
  const source = state.map?.getSource(SOURCE_IDS.stations);
  if (!source) {
    return;
  }

  const visibleStations = filterPointFeaturesToBounds(
    state.gis.stations,
    getStationViewportBounds(),
  );
  source.setData(visibleStations);
}

function buildBasemapSource() {
  const basemap = state.gis?.basemap;
  const sourceBounds = getSourceBounds();
  if (basemap?.enabled && basemap.tiles_url) {
    return {
      type: "raster",
      tiles: [basemap.tiles_url],
      tileSize: Number(basemap.tile_size || 256),
      minzoom: Number(basemap.minzoom || 0),
      maxzoom: Number(basemap.maxzoom || 22),
      attribution: basemap.name || "Local MBTiles",
      bounds: sourceBounds,
    };
  }

  return {
    type: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    attribution: "(c) OpenStreetMap contributors",
    bounds: sourceBounds,
  };
}

function initializeMap() {
  const basemapSource = buildBasemapSource();
  state.map = new maplibregl.Map({
    container: "gisMap",
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        basemap: basemapSource,
      },
      layers: [
        {
          id: "basemap-background",
          type: "background",
          paint: {
            "background-color": "#f4f1e8",
          },
        },
        {
          id: "basemap-raster",
          type: "raster",
          source: "basemap",
        },
      ],
    },
    center: [121.54, 25.05],
    zoom: 11.2,
    attributionControl: true,
  });

  state.map.addControl(new maplibregl.NavigationControl(), "top-right");
  state.map.on("load", handleMapLoad);
}

function handleMapLoad() {
  const focusBounds = getFocusBounds();
  state.focusBounds = focusBounds;
  state.map.addSource(SOURCE_IDS.lines, {
    type: "geojson",
    data: state.gis.lines,
  });
  state.map.addSource(SOURCE_IDS.stations, {
    type: "geojson",
    data: filterPointFeaturesToBounds(state.gis.stations, focusBounds),
  });
  state.map.addSource(SOURCE_IDS.pickedPoints, {
    type: "geojson",
    data: emptyFeatureCollection(),
  });
  state.map.addSource(SOURCE_IDS.selectedStations, {
    type: "geojson",
    data: emptyFeatureCollection(),
  });
  state.map.addSource(SOURCE_IDS.route, {
    type: "geojson",
    data: emptyFeatureCollection(),
  });

  state.map.addLayer({
    id: "metro-lines-casing",
    type: "line",
    source: SOURCE_IDS.lines,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(15,23,42,0.2)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3.6, 13, 7.6],
      "line-opacity": 0.72,
    },
  });

  state.map.addLayer({
    id: "metro-lines-base",
    type: "line",
    source: SOURCE_IDS.lines,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": ["coalesce", ["get", "line_color"], "#637081"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.6, 13, 5.8],
      "line-opacity": 0.84,
    },
  });

  state.map.addLayer({
    id: "route-lines-halo",
    type: "line",
    source: SOURCE_IDS.route,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(255,255,255,0.96)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 7, 13, 12],
      "line-opacity": 0.78,
    },
  });

  state.map.addLayer({
    id: "route-lines-ride",
    type: "line",
    source: SOURCE_IDS.route,
    filter: ["==", ["get", "kind"], "ride"],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#145ef2",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4.2, 13, 8.4],
      "line-opacity": 0.98,
      "line-dasharray": [1, 0],
    },
  });

  state.map.addLayer({
    id: "route-lines-walk",
    type: "line",
    source: SOURCE_IDS.route,
    filter: ["==", ["get", "kind"], "walk"],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#1f9d67",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4.2, 13, 7.8],
      "line-opacity": 0.96,
    },
  });

  state.map.addLayer({
    id: "metro-stations-circle",
    type: "circle",
    source: SOURCE_IDS.stations,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 13, 6.1],
      "circle-color": "#0f172a",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.6,
      "circle-opacity": 0.9,
    },
  });

  state.map.addLayer({
    id: "selected-stations-circle",
    type: "circle",
    source: SOURCE_IDS.selectedStations,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5.2, 13, 9.8],
      "circle-color": [
        "match",
        ["get", "role"],
        "start_station",
        "#2ca56d",
        "end_station",
        "#dd5a4f",
        "edit_station",
        "#145ef2",
        "#e6a91a",
      ],
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 2.1,
      "circle-opacity": 0.96,
    },
  });

  state.map.addLayer({
    id: "selected-stations-label",
    type: "symbol",
    source: SOURCE_IDS.selectedStations,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 14, 15],
      "text-offset": [0.9, -0.75],
      "text-anchor": "left",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": [
        "match",
        ["get", "role"],
        "start_station",
        "#14532d",
        "end_station",
        "#7f1d1d",
        "edit_station",
        "#1d4ed8",
        "#7a4d00",
      ],
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.8,
      "text-opacity": 1,
    },
  });

  state.map.addLayer({
    id: "picked-points-circle",
    type: "circle",
    source: SOURCE_IDS.pickedPoints,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4.4, 13, 8],
      "circle-color": [
        "match",
        ["get", "role"],
        "start_point",
        "#2ca56d",
        "#dd5a4f",
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 0.95,
    },
  });

  state.map.addLayer({
    id: "picked-points-label",
    type: "symbol",
    source: SOURCE_IDS.pickedPoints,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 13],
      "text-offset": [0, 1.25],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#0f172a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.6,
      "text-opacity": 0.98,
    },
  });

  state.map.addLayer({
    id: "metro-stations-label",
    type: "symbol",
    source: SOURCE_IDS.stations,
    minzoom: 11.8,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11.8, 10, 14, 13.5],
      "text-offset": [0.75, -0.65],
      "text-anchor": "left",
      "symbol-avoid-edges": true,
      "text-allow-overlap": true,
      "text-ignore-placement": false,
    },
    paint: {
      "text-color": "#0f172a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 11.8, 0, 12.6, 0.96],
    },
  });

  state.map.on("mouseenter", "metro-stations-circle", () => {
    state.map.getCanvas().style.cursor = state.stationEditMode ? "grab" : "pointer";
  });
  state.map.on("mouseleave", "metro-stations-circle", () => {
    if (!state.isDraggingStation) {
      state.map.getCanvas().style.cursor = "";
    }
  });
  state.map.on("mousedown", "metro-stations-circle", (event) => {
    if (!state.stationEditMode) {
      return;
    }
    startStationDrag(event);
  });

  state.map.on("click", "metro-stations-circle", (event) => {
    const feature = event.features?.[0];
    const stationId = feature?.properties?.id;
    if (!stationId) {
      return;
    }

    if (state.stationEditMode) {
      selectEditableStation(stationId);
      state.suppressNextMapClick = true;
      return;
    }

    if (state.pickMode === "via") {
      toggleViaStation(stationId);
      state.suppressNextMapClick = true;
      return;
    }

    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return;
    }
    if (state.pickMode === "start") {
      state.startPoint = { lon: Number(coordinates[0]), lat: Number(coordinates[1]) };
    } else if (state.pickMode === "end") {
      state.endPoint = { lon: Number(coordinates[0]), lat: Number(coordinates[1]) };
    }
    state.routeResult = null;
    state.suppressNextMapClick = true;
    updatePickedPointsSource();
    updateSelectedStationsSource();
    updateRouteSource(emptyFeatureCollection());
    renderAll();
    setStatus("Point updated. Click Find Route to calculate.");
  });

  state.map.on("click", (event) => {
    if (state.suppressNextMapClick) {
      state.suppressNextMapClick = false;
      return;
    }
    if (state.stationEditMode) {
      if (!state.editableStationId) {
        setStatus("Station edit mode: click a station first, then drag it or click the map to reposition.");
        return;
      }
      updateEditableStationCoordinate(
        state.editableStationId,
        [roundTo7(event.lngLat.lng), roundTo7(event.lngLat.lat)],
        { markDirty: true },
      );
      setStatus(
        `Moved ${formatStation(state.editableStationId)}. Save GeoJSON to persist the new position.`,
      );
      return;
    }
    if (state.pickMode === "via") {
      setStatus("Via mode: click on a station to add/remove stopover.");
      return;
    }

    const point = {
      lon: roundTo6(event.lngLat.lng),
      lat: roundTo6(event.lngLat.lat),
    };
    if (state.pickMode === "start") {
      state.startPoint = point;
    } else {
      state.endPoint = point;
    }
    state.routeResult = null;
    updatePickedPointsSource();
    updateSelectedStationsSource();
    updateRouteSource(emptyFeatureCollection());
    renderAll();
    setStatus("Point updated. Click Find Route to calculate.");
  });

  const minZoom = getEnvelopeMinZoom(focusBounds);
  state.map.setMinZoom(minZoom);
  state.map.jumpTo(getDefaultViewportCamera(focusBounds, minZoom));
  state.map.setMaxBounds([
    [focusBounds[0] - 0.0035, focusBounds[1] - 0.0035],
    [focusBounds[2] + 0.01, focusBounds[3] + 0.01],
  ]);
  refreshVisibleStationsSource();
  state.map.on("moveend", refreshVisibleStationsSource);

  updatePickedPointsSource();
  updateSelectedStationsSource();
  updateRouteSource(emptyFeatureCollection());
}

function setPickMode(mode) {
  state.pickMode = mode;
  elements.pickStartBtn.classList.toggle("active", mode === "start");
  elements.pickEndBtn.classList.toggle("active", mode === "end");
  elements.pickViaBtn.classList.toggle("active", mode === "via");
  if (state.stationEditMode) {
    setStatus("Station edit mode is active. Save or reload edits before returning to route picking.");
    return;
  }
  setStatus(getPickModeStatus(mode));
}

function toggleViaStation(stationId) {
  if (state.viaStationIds.includes(stationId)) {
    state.viaStationIds = state.viaStationIds.filter((id) => id !== stationId);
  } else {
    state.viaStationIds.push(stationId);
  }
  state.routeResult = null;
  updateSelectedStationsSource();
  updateRouteSource(emptyFeatureCollection());
  renderAll();
}

function clearViaStations() {
  state.viaStationIds = [];
  state.routeResult = null;
  updateSelectedStationsSource();
  updateRouteSource(emptyFeatureCollection());
  renderAll();
  setStatus("VIA stations cleared.");
}

function toggleStationEditMode() {
  if (state.stationEditMode && state.dirtyStationIds.size) {
    setStatus("Save GeoJSON or reload GIS stations before leaving edit mode.");
    return;
  }
  setStationEditMode(!state.stationEditMode);
}

function setStationEditMode(enabled) {
  state.stationEditMode = enabled;
  if (!enabled) {
    stopStationDrag();
    state.editableStationId = null;
  }
  updateSelectedStationsSource();
  renderAll();
  setStatus(
    enabled
      ? "Station edit mode enabled. Click a station to select it, drag it, or click the map to reposition."
      : getPickModeStatus(state.pickMode),
  );
}

function startStationDrag(event) {
  const feature = event.features?.[0];
  const stationId = feature?.properties?.id;
  if (!stationId || !state.map) {
    return;
  }

  selectEditableStation(stationId);
  stopStationDrag();
  state.suppressNextMapClick = true;
  state.isDraggingStation = false;
  state.map.dragPan.disable();
  state.map.getCanvas().style.cursor = "grabbing";

  state.stationDragMoveHandler = (moveEvent) => {
    state.isDraggingStation = true;
    updateEditableStationCoordinate(
      stationId,
      [roundTo7(moveEvent.lngLat.lng), roundTo7(moveEvent.lngLat.lat)],
      { markDirty: true },
    );
  };
  state.stationDragUpHandler = () => {
    const moved = state.isDraggingStation;
    stopStationDrag();
    setStatus(
      moved
        ? `Moved ${formatStation(stationId)}. Save GeoJSON to persist the new position.`
        : `Selected ${formatStation(stationId)} for editing.`,
    );
  };

  state.map.on("mousemove", state.stationDragMoveHandler);
  state.map.on("mouseup", state.stationDragUpHandler);
}

function stopStationDrag() {
  if (!state.map) {
    return;
  }
  if (state.stationDragMoveHandler) {
    state.map.off("mousemove", state.stationDragMoveHandler);
    state.stationDragMoveHandler = null;
  }
  if (state.stationDragUpHandler) {
    state.map.off("mouseup", state.stationDragUpHandler);
    state.stationDragUpHandler = null;
  }
  if (state.map.dragPan) {
    state.map.dragPan.enable();
  }
  state.isDraggingStation = false;
  state.map.getCanvas().style.cursor = state.stationEditMode ? "grab" : "";
}

function selectEditableStation(stationId) {
  state.editableStationId = stationId;
  updateSelectedStationsSource();
  renderAll();
}

function updateEditableStationCoordinate(stationId, coordinates, options = {}) {
  const feature = getStationGeoJsonFeature(stationId);
  if (!feature) {
    setStatus(`Station ${stationId} is not available in GIS GeoJSON.`);
    return;
  }

  const nextCoordinates = [roundTo7(coordinates[0]), roundTo7(coordinates[1])];
  feature.geometry = {
    ...feature.geometry,
    type: "Point",
    coordinates: nextCoordinates,
  };
  state.stationCoordsById.set(stationId, nextCoordinates);
  if (options.markDirty) {
    state.dirtyStationIds.add(stationId);
  }
  if (state.routeResult) {
    state.routeResult = null;
    updateRouteSource(emptyFeatureCollection());
  }
  refreshVisibleStationsSource();
  updateSelectedStationsSource();
  renderAll();
}

async function saveEditedStations() {
  if (!state.dirtyStationIds.size) {
    setStatus("No edited GIS stations to save.");
    return;
  }

  const stations = Array.from(state.dirtyStationIds).map((stationId) => {
    const feature = getStationGeoJsonFeature(stationId);
    const coordinates = state.stationCoordsById.get(stationId) || [null, null];
    return {
      id: stationId,
      lon: coordinates[0],
      lat: coordinates[1],
      deleted: Boolean(feature?.properties?.deleted),
    };
  });

  try {
    setStatus("Saving edited GIS stations...");
    const response = await fetch("/api/gis/stations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stations }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.detail || "Unable to save GIS stations.");
    }
    state.dirtyStationIds.clear();
    renderAll();
    setStatus(
      `Saved ${body.updated_count} GIS station${body.updated_count === 1 ? "" : "s"} to stations.geojson.`,
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to save GIS stations.");
  }
}

async function deleteEditableStation() {
  if (!state.stationEditMode) {
    setStatus("Enable station edit mode first.");
    return;
  }
  if (!state.editableStationId) {
    setStatus("Select a station first, then delete it.");
    return;
  }

  const stationId = state.editableStationId;
  const stationLabel = formatStation(stationId);
  if (!window.confirm(`Delete ${stationLabel} from GIS station nodes?`)) {
    return;
  }

  try {
    setStatus(`Deleting ${stationLabel}...`);
    const response = await fetch(`/api/gis/stations/${encodeURIComponent(stationId)}`, {
      method: "DELETE",
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.detail || "Unable to delete GIS station.");
    }

    const feature = getStationGeoJsonFeature(stationId);
    if (feature) {
      feature.properties = {
        ...(feature.properties || {}),
        deleted: true,
      };
    }
    state.dirtyStationIds.delete(stationId);
    state.editableStationId = null;
    state.viaStationIds = state.viaStationIds.filter((viaStationId) => viaStationId !== stationId);
    state.routeResult = null;
    refreshVisibleStationsSource();
    updateSelectedStationsSource();
    updateRouteSource(emptyFeatureCollection());
    renderAll();
    setStatus(`Deleted ${stationLabel} from GIS station nodes.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || `Unable to delete ${stationLabel}.`);
  } finally {
    stopStationDrag();
  }
}

async function reloadGisStations() {
  try {
    setStatus("Reloading GIS stations from GeoJSON...");
    const response = await fetch("/api/gis/network");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "Unable to reload GIS stations.");
    }
    state.gis = payload;
    state.routeResult = null;
    state.dirtyStationIds.clear();
    if (state.editableStationId && !payload.stations?.features?.some((feature) => feature?.properties?.id === state.editableStationId)) {
      state.editableStationId = null;
    }
    buildStationCoordinateLookup();
    state.map?.getSource(SOURCE_IDS.lines)?.setData(state.gis.lines);
    refreshVisibleStationsSource();
    updatePickedPointsSource();
    updateSelectedStationsSource();
    updateRouteSource(emptyFeatureCollection());
    renderAll();
    setStatus("GIS stations reloaded from GeoJSON.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to reload GIS stations.");
  }
}

async function findRouteForPoints() {
  if (!state.startPoint || !state.endPoint) {
    setStatus("Please pick both START and END points first.");
    return;
  }

  try {
    setStatus("Calculating route...");
    const response = await fetch("/api/gis/route/points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_lon: state.startPoint.lon,
        start_lat: state.startPoint.lat,
        end_lon: state.endPoint.lon,
        end_lat: state.endPoint.lat,
        via_station_ids: state.viaStationIds,
        walking_m_per_sec: 1.3,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "Unable to calculate route.");
    }

    state.routeResult = payload;
    updateSelectedStationsSource();
    updateRouteSource(buildRouteGeoJson(payload));
    renderAll();
    setStatus("Route ready with highlighted travel path.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Route calculation failed.");
  }
}

function buildRouteGeoJson(resultPayload) {
  const features = [];
  const route = resultPayload.route || {};
  const ridePathFeatures = Array.isArray(resultPayload.ride_path_features)
    ? resultPayload.ride_path_features
    : [];

  (route.steps || []).forEach((step) => {
    if (step.kind === "transfer" || !step.next_station_id) {
      return;
    }
    if (step.kind === "ride" && ridePathFeatures.length) {
      return;
    }
    const from = state.stationCoordsById.get(step.station_id);
    const to = state.stationCoordsById.get(step.next_station_id);
    if (!from || !to) {
      return;
    }
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [from, to],
      },
      properties: {
        kind: step.kind === "ride" ? "ride" : "walk",
      },
    });
  });

  ridePathFeatures.forEach((feature) => {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return;
    }
    features.push(feature);
  });

  if (Array.isArray(resultPayload.access_walk_path?.coordinates) && resultPayload.access_walk_path.coordinates.length >= 2) {
    features.push({
      type: "Feature",
      geometry: resultPayload.access_walk_path,
      properties: { kind: "walk" },
    });
  } else {
    const startStationCoords = state.stationCoordsById.get(resultPayload.selected_start_station?.id);
    if (state.startPoint && startStationCoords) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [state.startPoint.lon, state.startPoint.lat],
            startStationCoords,
          ],
        },
        properties: { kind: "walk" },
      });
    }
  }

  if (Array.isArray(resultPayload.egress_walk_path?.coordinates) && resultPayload.egress_walk_path.coordinates.length >= 2) {
    features.push({
      type: "Feature",
      geometry: resultPayload.egress_walk_path,
      properties: { kind: "walk" },
    });
  } else {
    const endStationCoords = state.stationCoordsById.get(resultPayload.selected_end_station?.id);
    if (state.endPoint && endStationCoords) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            endStationCoords,
            [state.endPoint.lon, state.endPoint.lat],
          ],
        },
        properties: { kind: "walk" },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function updatePickedPointsSource() {
  const source = state.map?.getSource(SOURCE_IDS.pickedPoints);
  if (!source) {
    return;
  }

  const features = [];
  if (state.startPoint) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [state.startPoint.lon, state.startPoint.lat],
      },
      properties: { role: "start_point", label: "Start point" },
    });
  }
  if (state.endPoint) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [state.endPoint.lon, state.endPoint.lat],
      },
      properties: { role: "end_point", label: "End point" },
    });
  }

  source.setData({
    type: "FeatureCollection",
    features,
  });
}

function updateSelectedStationsSource() {
  const source = state.map?.getSource(SOURCE_IDS.selectedStations);
  if (!source) {
    return;
  }

  const features = [];
  if (state.stationEditMode && state.editableStationId) {
    features.push(buildStationFeature(state.editableStationId, "edit_station"));
  }
  if (state.routeResult?.selected_start_station?.id) {
    features.push(buildStationFeature(state.routeResult.selected_start_station.id, "start_station"));
  }
  if (state.routeResult?.selected_end_station?.id) {
    features.push(buildStationFeature(state.routeResult.selected_end_station.id, "end_station"));
  }
  state.viaStationIds.forEach((stationId) => {
    features.push(buildStationFeature(stationId, "via_station"));
  });

  source.setData({
    type: "FeatureCollection",
    features: features.filter(Boolean),
  });
}

function buildStationFeature(stationId, role) {
  const coordinates = state.stationCoordsById.get(stationId);
  if (!coordinates) {
    return null;
  }
  const station = state.stationById.get(stationId);
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates,
    },
    properties: {
      id: stationId,
      name: station?.name || stationId,
      role,
    },
  };
}

function getStationGeoJsonFeature(stationId) {
  return (state.gis?.stations?.features || []).find(
    (feature) => feature?.properties?.id === stationId,
  ) || null;
}

function isDeletedStationFeature(feature) {
  return Boolean(feature?.properties?.deleted);
}

function updateRouteSource(featureCollection) {
  const source = state.map?.getSource(SOURCE_IDS.route);
  if (!source) {
    return;
  }
  source.setData(featureCollection);
}

function renderAll() {
  renderSelectionCard();
  renderEditorCard();
  renderSummary();
  renderSteps();
  syncEditorControls();
}

function renderSelectionCard() {
  const cards = [];

  if (state.startPoint) {
    cards.push(renderMetricCard("Start Point", formatLonLat(state.startPoint)));
  }
  if (state.endPoint) {
    cards.push(renderMetricCard("End Point", formatLonLat(state.endPoint)));
  }
  if (state.viaStationIds.length) {
    cards.push(
      renderMetricCard(
        "VIA Stations",
        state.viaStationIds
          .map((stationId) => state.stationById.get(stationId)?.name || stationId)
          .join(" -> "),
      ),
    );
  }
  if (state.routeResult) {
    cards.push(
      renderMetricCard(
        "Snap Start Station",
        formatStation(state.routeResult.selected_start_station?.id),
      ),
    );
    cards.push(
      renderMetricCard(
        "Snap End Station",
        formatStation(state.routeResult.selected_end_station?.id),
      ),
    );
  }

  if (!cards.length) {
    elements.selectionCard.classList.add("empty");
    elements.selectionCard.textContent = "Click anywhere on map for start/end points.";
    return;
  }
  elements.selectionCard.classList.remove("empty");
  elements.selectionCard.innerHTML = cards.join("");
}

function renderSummary() {
  if (!state.routeResult) {
    elements.summaryCard.classList.add("empty");
    elements.summaryCard.textContent = "No route yet.";
    return;
  }

  const route = state.routeResult.route || {};
  const lineLabels = (route.line_labels || []).join(" -> ") || "No ride";

  elements.summaryCard.classList.remove("empty");
  elements.summaryCard.innerHTML = [
    renderMetricCard("Total Journey", formatDuration(state.routeResult.total_journey_time_sec || 0)),
    renderMetricCard("Subway Time", formatDuration(route.total_time_sec || 0)),
    renderMetricCard(
      "Walking",
      formatDuration((state.routeResult.access_walk_time_sec || 0) + (state.routeResult.egress_walk_time_sec || 0)),
    ),
    renderMetricCard(
      "Walk Dist.",
      `${Math.round((state.routeResult.access_walk_distance_m || 0) + (state.routeResult.egress_walk_distance_m || 0))} m`,
    ),
    renderMetricCard("Line Sequence", lineLabels),
  ].join("");
}

function renderEditorCard() {
  const dirtyCount = state.dirtyStationIds.size;
  const selectedStationId = state.editableStationId;
  const selectedCoordinates = selectedStationId ? state.stationCoordsById.get(selectedStationId) : null;

  if (!state.stationEditMode && !dirtyCount) {
    elements.editorCard.classList.add("empty");
    elements.editorCard.textContent = "Editor off. Enable edit mode to move stations.";
    return;
  }

  elements.editorCard.classList.remove("empty");
  if (!selectedStationId || !selectedCoordinates) {
    elements.editorCard.innerHTML = [
      renderMetricCard("Editor", state.stationEditMode ? "Enabled" : "Disabled"),
      renderMetricCard("Unsaved", String(dirtyCount)),
    ].join("");
    return;
  }

  elements.editorCard.innerHTML = [
    renderMetricCard("Editing", formatStation(selectedStationId)),
    renderMetricCard("Lon / Lat", `${selectedCoordinates[0].toFixed(6)}, ${selectedCoordinates[1].toFixed(6)}`),
    renderMetricCard("Unsaved", String(dirtyCount)),
  ].join("");
}

function renderSteps() {
  if (!state.routeResult) {
    elements.stepsList.innerHTML = '<li class="empty">Pick start and end points, then calculate route.</li>';
    return;
  }

  const route = state.routeResult.route || {};
  const items = [];

  items.push(
    renderStepCard({
      title: `Walk to ${state.routeResult.selected_start_station?.name || "entry station"}`,
      description: "From picked start point",
      duration: formatDuration(state.routeResult.access_walk_time_sec || 0),
      badge: `${Math.round(state.routeResult.access_walk_distance_m || 0)} m`,
    }),
  );

  summarizeRouteSteps(route).forEach((step) => {
    items.push(renderStepCard(step));
  });

  items.push(
    renderStepCard({
      title: `Walk to destination from ${state.routeResult.selected_end_station?.name || "exit station"}`,
      description: "From exit station to picked end point",
      duration: formatDuration(state.routeResult.egress_walk_time_sec || 0),
      badge: `${Math.round(state.routeResult.egress_walk_distance_m || 0)} m`,
    }),
  );

  elements.stepsList.innerHTML = items.join("");
}

function summarizeRouteSteps(route) {
  const summaries = [];
  const steps = route?.steps || [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const from = state.stationById.get(step.station_id)?.name || step.station_id;
    const to = state.stationById.get(step.next_station_id)?.name || step.next_station_id;
    const lineName = state.lineById.get(step.line_id)?.name || step.line_id;

    if (step.kind === "ride") {
      let totalDuration = step.duration_sec;
      let finalTo = to;
      let stopCount = 1;
      let nextIndex = index + 1;

      while (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        if (nextStep.kind !== "ride" || nextStep.line_id !== step.line_id) {
          break;
        }
        totalDuration += nextStep.duration_sec;
        stopCount += 1;
        finalTo = state.stationById.get(nextStep.next_station_id)?.name || nextStep.next_station_id;
        nextIndex += 1;
      }

      summaries.push({
        title: `Ride ${lineName}`,
        description: `${from} -> ${finalTo}`,
        duration: formatDuration(totalDuration),
        badge: stopCount === 1 ? "1 stop" : `${stopCount} stops`,
      });
      index = nextIndex - 1;
      continue;
    }

    if (step.kind === "transfer") {
      summaries.push({
        title: `Transfer at ${from}`,
        description: `Switch line after ${lineName}`,
        duration: formatDuration(step.duration_sec),
        badge: "transfer",
      });
      continue;
    }

    summaries.push({
      title: `Walk link at ${from}`,
      description: `${from} -> ${to}`,
      duration: formatDuration(step.duration_sec),
      badge: "walk",
    });
  }

  return summaries;
}

function renderStepCard(step) {
  const badgeMarkup = step.badge
    ? `<span class="step-card__badge">${escapeHtml(step.badge)}</span>`
    : "";
  return `
    <li class="step-card">
      <div class="step-card__title-row">
        <strong>${escapeHtml(step.title)}</strong>
        <span class="step-card__duration">${escapeHtml(step.duration)}</span>
      </div>
      <div class="step-card__meta">
        <span class="step-card__description">${escapeHtml(step.description)}</span>
        ${badgeMarkup}
      </div>
    </li>
  `;
}

function renderMetricCard(label, value) {
  return `
    <div class="summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function resetAll() {
  state.startPoint = null;
  state.endPoint = null;
  state.viaStationIds = [];
  state.routeResult = null;
  updatePickedPointsSource();
  updateSelectedStationsSource();
  updateRouteSource(emptyFeatureCollection());
  renderAll();
  setPickMode("start");
  setStatus("Selection reset.");
}

function syncEditorControls() {
  elements.toggleEditBtn.textContent = state.stationEditMode ? "Disable Edit" : "Enable Edit";
  elements.saveStationsBtn.disabled = state.dirtyStationIds.size === 0;
  elements.deleteStationBtn.disabled = !state.stationEditMode || !state.editableStationId;
  [
    elements.pickStartBtn,
    elements.pickEndBtn,
    elements.pickViaBtn,
    elements.clearViaBtn,
    elements.findRouteBtn,
  ].forEach((element) => {
    element.disabled = state.stationEditMode;
  });
}

function formatStation(stationId) {
  if (!stationId) {
    return "N/A";
  }
  const station = state.stationById.get(stationId);
  if (!station) {
    return stationId;
  }
  return `${station.name} (${station.id})`;
}

function formatLonLat(point) {
  return `${point.lon.toFixed(5)}, ${point.lat.toFixed(5)}`;
}

function getPickModeStatus(mode) {
  return mode === "start"
    ? "Click anywhere on map to set START point."
    : mode === "end"
      ? "Click anywhere on map to set END point."
      : "Via mode: click station circles to add/remove stopovers.";
}

function formatDuration(totalSec) {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function roundTo6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundTo7(value) {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

init();

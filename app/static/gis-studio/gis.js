const state = {
  network: null,
  gis: null,
  map: null,
  pickMode: "start",
  startPoint: null,
  endPoint: null,
  viaStationIds: [],
  routeResult: null,
  stationCoordsById: new Map(),
  stationById: new Map(),
  lineById: new Map(),
  suppressNextMapClick: false,
};

const elements = {
  gisSourceBadge: document.getElementById("gisSourceBadge"),
  pickStartBtn: document.getElementById("pickStartBtn"),
  pickEndBtn: document.getElementById("pickEndBtn"),
  pickViaBtn: document.getElementById("pickViaBtn"),
  clearViaBtn: document.getElementById("clearViaBtn"),
  findRouteBtn: document.getElementById("findRouteBtn"),
  resetBtn: document.getElementById("resetBtn"),
  statusText: document.getElementById("statusText"),
  selectionCard: document.getElementById("selectionCard"),
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

    elements.gisSourceBadge.textContent = state.gis.source === "qgis_geojson"
      ? "QGIS GeoJSON"
      : "Fallback Projection";
    setStatus(
      state.gis.source === "qgis_geojson"
        ? "GIS source loaded from QGIS export."
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
}

function initializeMap() {
  state.map = new maplibregl.Map({
    container: "gisMap",
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [
        {
          id: "osm-base",
          type: "raster",
          source: "osm",
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
  state.map.addSource(SOURCE_IDS.lines, {
    type: "geojson",
    data: state.gis.lines,
  });
  state.map.addSource(SOURCE_IDS.stations, {
    type: "geojson",
    data: state.gis.stations,
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
    id: "metro-lines-base",
    type: "line",
    source: SOURCE_IDS.lines,
    paint: {
      "line-color": ["coalesce", ["get", "line_color"], "#637081"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 13, 5],
      "line-opacity": 0.62,
    },
  });

  state.map.addLayer({
    id: "route-lines-halo",
    type: "line",
    source: SOURCE_IDS.route,
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
    paint: {
      "line-color": "#e6a91a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4.0, 13, 7.6],
      "line-opacity": 0.98,
      "line-dasharray": [1.9, 1.2],
    },
  });

  state.map.addLayer({
    id: "metro-stations-circle",
    type: "circle",
    source: SOURCE_IDS.stations,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.4, 13, 6.8],
      "circle-color": "#0f172a",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.8,
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
    state.map.getCanvas().style.cursor = "pointer";
  });
  state.map.on("mouseleave", "metro-stations-circle", () => {
    state.map.getCanvas().style.cursor = "";
  });

  state.map.on("click", "metro-stations-circle", (event) => {
    const feature = event.features?.[0];
    const stationId = feature?.properties?.id;
    if (!stationId) {
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

  const bounds = state.gis.bounds || [121.45, 24.95, 121.65, 25.15];
  state.map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    { padding: 40, duration: 0 },
  );
  state.map.setMaxBounds([
    [bounds[0] - 0.04, bounds[1] - 0.04],
    [bounds[2] + 0.04, bounds[3] + 0.04],
  ]);

  updatePickedPointsSource();
  updateSelectedStationsSource();
  updateRouteSource(emptyFeatureCollection());
}

function setPickMode(mode) {
  state.pickMode = mode;
  elements.pickStartBtn.classList.toggle("active", mode === "start");
  elements.pickEndBtn.classList.toggle("active", mode === "end");
  elements.pickViaBtn.classList.toggle("active", mode === "via");
  setStatus(
    mode === "start"
      ? "Click anywhere on map to set START point."
      : mode === "end"
        ? "Click anywhere on map to set END point."
        : "Via mode: click station circles to add/remove stopovers.",
  );
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

  (route.steps || []).forEach((step) => {
    if (step.kind === "transfer" || !step.next_station_id) {
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

  const startStationCoords = state.stationCoordsById.get(resultPayload.selected_start_station?.id);
  const endStationCoords = state.stationCoordsById.get(resultPayload.selected_end_station?.id);
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

function updateRouteSource(featureCollection) {
  const source = state.map?.getSource(SOURCE_IDS.route);
  if (!source) {
    return;
  }
  source.setData(featureCollection);
}

function renderAll() {
  renderSelectionCard();
  renderSummary();
  renderSteps();
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

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

init();

const STORAGE_KEY = 'mrt-admin-session-v3';
const FEED_LIMIT = 7;
const MAP_SOURCE_IDS = {
  basemapLines: 'admin-metro-lines',
  basemapStations: 'admin-metro-stations',
  rainZones: 'admin-rain-zones',
  blockSegments: 'admin-block-segments',
  temporaryPoint: 'admin-temporary-point',
  bannedStations: 'admin-banned-stations',
};

const state = {
  network: null,
  gis: null,
  map: null,
  lineById: new Map(),
  stationById: new Map(),
  stationCoordsById: new Map(),
  mapBounds: [121.45, 24.95, 121.65, 25.15],
  mode: 'rain',
  rainZones: [],
  blockSegments: [],
  temporaryPoint: null,
  bannedStationIds: new Set(),
  activityFeed: [],
};

const elements = {
  modeRain: document.getElementById('modeRain'),
  modeBlock: document.getElementById('modeBlock'),
  clearAll: document.getElementById('clearAll'),
  exportRules: document.getElementById('exportRules'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  statusText: document.getElementById('statusText'),
  modeLabel: document.getElementById('modeLabel'),
  modeHint: document.getElementById('modeHint'),
  networkSourceLabel: document.getElementById('networkSourceLabel'),
  totalRuleCount: document.getElementById('totalRuleCount'),
  lineCount: document.getElementById('lineCount'),
  stationCount: document.getElementById('stationCount'),
  segmentCount: document.getElementById('segmentCount'),
  bannedCount: document.getElementById('bannedCount'),
  rainCount: document.getElementById('rainCount'),
  blockCount: document.getElementById('blockCount'),
  selectedBannedCount: document.getElementById('selectedBannedCount'),
  bannedStations: document.getElementById('bannedStations'),
  rulesSummary: document.getElementById('rulesSummary'),
  activityFeed: document.getElementById('activityFeed'),
  mapHelper: document.getElementById('mapHelper'),
};

async function init() {
  if (!window.maplibregl) {
    setStatus('MapLibre failed to load. Check CDN or network access.');
    return;
  }

  try {
    setStatus('Loading GIS network...');
    const gisResponse = await fetch('/api/gis/network');
    state.gis = await gisResponse.json();
    state.network = buildNetworkCatalog(state.gis);

    if (!gisResponse.ok) {
      throw new Error(state.gis?.detail || 'Failed to load GIS payload for admin.');
    }

    state.lineById = new Map((state.network.lines || []).map((line) => [line.id, line]));
    state.stationById = new Map((state.network.stations || []).map((station) => [station.id, station]));
    state.mapBounds = state.gis.basemap?.bounds || state.gis.bounds || state.mapBounds;

    buildStationCoordinateLookup();
    hydrateSession();
    bindEvents();
    initBannedStationSelector();
    applyHydratedSelections();
    renderActivityFeed();
    initializeMap();
    render();

    addFeed(
      'Admin map ready',
      `Loaded ${state.network.stations.length} stations and ${state.network.lines.length} lines on GIS map.`
    );
    setStatus('Admin studio is ready. Use the GIS map to draw rain zones or block segments.');
  } catch (error) {
    console.error(error);
    setStatus(`Initialization error: ${error.message}`);
    elements.rulesSummary.textContent = JSON.stringify({ error: error.message }, null, 2);
  }
}

function buildNetworkCatalog(gisPayload) {
  const stationCatalog = Array.isArray(gisPayload?.station_catalog) ? gisPayload.station_catalog : [];
  const lineCatalog = Array.isArray(gisPayload?.line_catalog) ? gisPayload.line_catalog : [];
  const stationFeatures = Array.isArray(gisPayload?.stations?.features) ? gisPayload.stations.features : [];
  const lineFeatures = Array.isArray(gisPayload?.lines?.features) ? gisPayload.lines.features : [];

  const stations = stationCatalog.length
    ? stationCatalog.map((station) => ({
        id: station.id,
        name: station.name || station.id,
        line_ids: Array.isArray(station.line_ids) ? station.line_ids : [],
      }))
    : stationFeatures
        .map((feature) => {
          const properties = feature?.properties || {};
          if (!properties.id) {
            return null;
          }
          return {
            id: properties.id,
            name: properties.name || properties.id,
            line_ids: Array.isArray(properties.line_ids) ? properties.line_ids : [],
          };
        })
        .filter(Boolean);

  const lines = lineCatalog.length
    ? lineCatalog.map((line) => ({
        id: line.id,
        name: line.name || line.id,
        color: line.color || '#64748b',
      }))
    : [...new Map(
        lineFeatures
          .map((feature) => {
            const properties = feature?.properties || {};
            if (!properties.line_id) {
              return null;
            }
            return [
              properties.line_id,
              {
                id: properties.line_id,
                name: properties.line_name || properties.line_id,
                color: properties.line_color || '#64748b',
              },
            ];
          })
          .filter(Boolean)
      ).values()];

  const segments = lineFeatures
    .map((feature) => {
      const properties = feature?.properties || {};
      if (!properties.line_id || !properties.from_station_id || !properties.to_station_id) {
        return null;
      }
      return {
        line_id: properties.line_id,
        from_station_id: properties.from_station_id,
        to_station_id: properties.to_station_id,
      };
    })
    .filter(Boolean);

  return { stations, lines, segments };
}

function bindEvents() {
  elements.modeRain.addEventListener('click', () => setMode('rain'));
  elements.modeBlock.addEventListener('click', () => setMode('block'));
  elements.clearAll.addEventListener('click', resetAll);
  elements.exportRules.addEventListener('click', exportRules);
  elements.zoomInBtn.addEventListener('click', () => state.map?.zoomIn());
  elements.zoomOutBtn.addEventListener('click', () => state.map?.zoomOut());
  elements.zoomResetBtn.addEventListener('click', resetMapView);
  elements.bannedStations.addEventListener('change', () => {
    const selected = Array.from(elements.bannedStations.selectedOptions).map((option) => option.value);
    setBannedStations(selected);
  });
  window.addEventListener('resize', () => state.map?.resize());
}

function initializeMap() {
  const basemapSource = buildBasemapSource();

  state.map = new maplibregl.Map({
    container: 'adminMap',
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        basemap: basemapSource,
      },
      layers: [
        {
          id: 'admin-basemap-background',
          type: 'background',
          paint: {
            'background-color': '#f6f4ec',
          },
        },
        {
          id: 'admin-basemap-raster',
          type: 'raster',
          source: 'basemap',
        },
      ],
    },
    center: [121.54, 25.05],
    zoom: 11.2,
    attributionControl: true,
  });

  state.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  state.map.on('load', handleMapLoad);
}

function buildBasemapSource() {
  const basemap = state.gis?.basemap;
  if (basemap?.enabled && basemap.tiles_url) {
    return {
      type: 'raster',
      tiles: [basemap.tiles_url],
      tileSize: Number(basemap.tile_size || 256),
      minzoom: Number(basemap.minzoom || 0),
      maxzoom: Number(basemap.maxzoom || 22),
      attribution: basemap.name || 'Local MBTiles',
    };
  }

  return {
    type: 'raster',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '(c) OpenStreetMap contributors',
  };
}

function handleMapLoad() {
  state.map.addSource(MAP_SOURCE_IDS.basemapLines, {
    type: 'geojson',
    data: state.gis.lines,
  });
  state.map.addSource(MAP_SOURCE_IDS.basemapStations, {
    type: 'geojson',
    data: state.gis.stations,
  });
  state.map.addSource(MAP_SOURCE_IDS.rainZones, {
    type: 'geojson',
    data: emptyFeatureCollection(),
  });
  state.map.addSource(MAP_SOURCE_IDS.blockSegments, {
    type: 'geojson',
    data: emptyFeatureCollection(),
  });
  state.map.addSource(MAP_SOURCE_IDS.temporaryPoint, {
    type: 'geojson',
    data: emptyFeatureCollection(),
  });
  state.map.addSource(MAP_SOURCE_IDS.bannedStations, {
    type: 'geojson',
    data: emptyFeatureCollection(),
  });

  state.map.addLayer({
    id: 'admin-lines-casing',
    type: 'line',
    source: MAP_SOURCE_IDS.basemapLines,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': 'rgba(15,23,42,0.18)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.8, 13, 7.6],
      'line-opacity': 0.7,
    },
  });

  state.map.addLayer({
    id: 'admin-lines-base',
    type: 'line',
    source: MAP_SOURCE_IDS.basemapLines,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': ['coalesce', ['get', 'line_color'], '#64748b'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.6, 13, 5.8],
      'line-opacity': 0.82,
    },
  });

  state.map.addLayer({
    id: 'admin-rain-fill',
    type: 'fill',
    source: MAP_SOURCE_IDS.rainZones,
    paint: {
      'fill-color': '#2563eb',
      'fill-opacity': 0.16,
    },
  });

  state.map.addLayer({
    id: 'admin-rain-outline',
    type: 'line',
    source: MAP_SOURCE_IDS.rainZones,
    paint: {
      'line-color': '#1d4ed8',
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 13, 2.6],
      'line-opacity': 0.94,
    },
  });

  state.map.addLayer({
    id: 'admin-block-lines',
    type: 'line',
    source: MAP_SOURCE_IDS.blockSegments,
    filter: ['==', ['get', 'kind'], 'line'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#dc2626',
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4.6, 13, 8.2],
      'line-opacity': 0.96,
    },
  });

  state.map.addLayer({
    id: 'admin-block-points',
    type: 'circle',
    source: MAP_SOURCE_IDS.blockSegments,
    filter: ['==', ['get', 'kind'], 'point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5.6, 13, 10.8],
      'circle-color': '#dc2626',
      'circle-stroke-color': '#fee2e2',
      'circle-stroke-width': 2.2,
      'circle-opacity': 0.96,
    },
  });

  state.map.addLayer({
    id: 'admin-stations-base',
    type: 'circle',
    source: MAP_SOURCE_IDS.basemapStations,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.8, 13, 5.8],
      'circle-color': '#111827',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.86,
    },
  });

  state.map.addLayer({
    id: 'admin-banned-stations',
    type: 'circle',
    source: MAP_SOURCE_IDS.bannedStations,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5.2, 13, 10.6],
      'circle-color': '#b45309',
      'circle-stroke-color': '#fff7ed',
      'circle-stroke-width': 2.3,
      'circle-opacity': 0.98,
    },
  });

  state.map.addLayer({
    id: 'admin-banned-labels',
    type: 'symbol',
    source: MAP_SOURCE_IDS.bannedStations,
    minzoom: 11,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13],
      'text-offset': [0.85, -0.7],
      'text-anchor': 'left',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#7c2d12',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.7,
      'text-opacity': 0.98,
    },
  });

  state.map.addLayer({
    id: 'admin-temp-point',
    type: 'circle',
    source: MAP_SOURCE_IDS.temporaryPoint,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 6, 13, 11],
      'circle-color': '#f59e0b',
      'circle-stroke-color': '#fef3c7',
      'circle-stroke-width': 2.4,
      'circle-opacity': 0.96,
    },
  });

  state.map.on('mouseenter', 'admin-stations-base', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseleave', 'admin-stations-base', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('click', 'admin-stations-base', (event) => {
    const feature = event.features?.[0];
    if (!feature) {
      return;
    }
    const stationId = feature.properties?.id;
    const station = state.stationById.get(stationId);
    const coordinates = feature.geometry?.coordinates;
    if (!station || !Array.isArray(coordinates) || coordinates.length < 2) {
      return;
    }

    new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 10 })
      .setLngLat([coordinates[0], coordinates[1]])
      .setHTML(
        `<div class="station-popup"><strong>${escapeHtml(station.name)}</strong><span>${escapeHtml(station.id)}</span></div>`
      )
      .addTo(state.map);
  });

  state.map.on('click', (event) => {
    handleMapClick({
      lon: roundTo6(event.lngLat.lng),
      lat: roundTo6(event.lngLat.lat),
    });
  });

  resetMapView();
  applyMapBoundsConstraint();
  updateMapSources();
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

function resetMapView() {
  if (!state.map) {
    return;
  }
  const bounds = state.mapBounds;
  state.map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    { padding: 42, duration: 400 }
  );
}

function applyMapBoundsConstraint() {
  if (!state.map) {
    return;
  }
  const bounds = state.mapBounds;
  state.map.setMaxBounds([
    [bounds[0] - 0.04, bounds[1] - 0.04],
    [bounds[2] + 0.04, bounds[3] + 0.04],
  ]);
}

function setMode(mode) {
  state.mode = mode;
  state.temporaryPoint = null;
  elements.modeRain.classList.toggle('active', mode === 'rain');
  elements.modeBlock.classList.toggle('active', mode === 'block');
  elements.modeLabel.textContent = mode === 'rain' ? 'Rain Zone' : 'Block Segment';
  elements.modeHint.textContent =
    mode === 'rain'
      ? 'Create an affected area with 2 map clicks'
      : 'Create a blocked line or a blocked point';
  setStatus(
    mode === 'rain'
      ? 'Rain mode is active. Click center first, then click again to set radius.'
      : 'Block mode is active. Click one point or two points on the GIS map.'
  );
  updateMapSources();
  updateMapHelper();
}

function handleMapClick(point) {
  if (state.mode === 'rain') {
    if (!state.temporaryPoint) {
      state.temporaryPoint = point;
      setStatus('Rain center selected. Click a second point to define the radius.');
      updateMapSources();
      updateMapHelper();
      return;
    }
    addRainZone(state.temporaryPoint, point);
    return;
  }

  if (!state.temporaryPoint) {
    state.temporaryPoint = point;
    setStatus('Block start point selected. Click again to create a segment or near the same point for a blocked point.');
    updateMapSources();
    updateMapHelper();
    return;
  }

  const distanceM = haversineDistanceM(
    state.temporaryPoint.lat,
    state.temporaryPoint.lon,
    point.lat,
    point.lon
  );
  if (distanceM < 70) {
    addBlockPoint(point);
    return;
  }

  addBlockSegment(state.temporaryPoint, point);
}

function addRainZone(centerPoint, edgePoint) {
  const radiusM = haversineDistanceM(centerPoint.lat, centerPoint.lon, edgePoint.lat, edgePoint.lon);
  state.rainZones.push({
    center: centerPoint,
    radius_m: Math.max(30, Math.round(radiusM)),
  });
  state.temporaryPoint = null;
  addFeed(
    'Rain zone added',
    `${formatLonLat(centerPoint)} with radius ${Math.round(radiusM)} m.`
  );
  setStatus('A new rain zone was added to the GIS map.');
  render();
}

function addBlockSegment(fromPoint, toPoint) {
  state.blockSegments.push({
    kind: 'line',
    from: fromPoint,
    to: toPoint,
  });
  state.temporaryPoint = null;
  addFeed(
    'Block segment added',
    `${formatLonLat(fromPoint)} -> ${formatLonLat(toPoint)}`
  );
  setStatus('A new blocked segment was added.');
  render();
}

function addBlockPoint(point) {
  state.blockSegments.push({
    kind: 'point',
    from: point,
    to: point,
  });
  state.temporaryPoint = null;
  addFeed('Blocked point added', formatLonLat(point));
  setStatus('A blocked point was added.');
  render();
}

function setBannedStations(stationIds) {
  state.bannedStationIds = new Set(stationIds);
  addFeed('Banned stations updated', `${state.bannedStationIds.size} stations are blocked.`);
  render();
}

function resetAll() {
  state.rainZones = [];
  state.blockSegments = [];
  state.temporaryPoint = null;
  state.bannedStationIds.clear();
  Array.from(elements.bannedStations.options).forEach((option) => {
    option.selected = false;
  });
  addFeed('Rules cleared', 'Rain zones, blocked segments, and banned stations were reset.');
  setStatus('All admin rules were cleared.');
  render();
}

function render() {
  renderMetrics();
  updateRulesSummary();
  updateMapSources();
  updateMapHelper();
}

function updateMapSources() {
  updateGeoJsonSource(MAP_SOURCE_IDS.rainZones, buildRainZoneFeatureCollection());
  updateGeoJsonSource(MAP_SOURCE_IDS.blockSegments, buildBlockFeatureCollection());
  updateGeoJsonSource(MAP_SOURCE_IDS.temporaryPoint, buildTemporaryPointFeatureCollection());
  updateGeoJsonSource(MAP_SOURCE_IDS.bannedStations, buildBannedStationFeatureCollection());
}

function updateGeoJsonSource(sourceId, data) {
  const source = state.map?.getSource(sourceId);
  if (!source) {
    return;
  }
  source.setData(data);
}

function buildRainZoneFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: state.rainZones.map((zone, index) => {
      const polygonCoordinates = buildCirclePolygon(zone.center.lon, zone.center.lat, zone.radius_m, 48);
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [polygonCoordinates],
        },
        properties: {
          id: `rain-${index + 1}`,
          radius_m: zone.radius_m,
        },
      };
    }),
  };
}

function buildBlockFeatureCollection() {
  const features = [];
  state.blockSegments.forEach((segment, index) => {
    if (segment.kind === 'point') {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [segment.from.lon, segment.from.lat],
        },
        properties: {
          id: `block-${index + 1}`,
          kind: 'point',
        },
      });
      return;
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [segment.from.lon, segment.from.lat],
          [segment.to.lon, segment.to.lat],
        ],
      },
      properties: {
        id: `block-${index + 1}`,
        kind: 'line',
      },
    });
  });
  return {
    type: 'FeatureCollection',
    features,
  };
}

function buildTemporaryPointFeatureCollection() {
  if (!state.temporaryPoint) {
    return emptyFeatureCollection();
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [state.temporaryPoint.lon, state.temporaryPoint.lat],
        },
        properties: {
          role: 'temporary',
        },
      },
    ],
  };
}

function buildBannedStationFeatureCollection() {
  const features = [...state.bannedStationIds]
    .map((stationId) => {
      const coordinates = state.stationCoordsById.get(stationId);
      const station = state.stationById.get(stationId);
      if (!coordinates || !station) {
        return null;
      }
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          id: station.id,
          name: station.name,
        },
      };
    })
    .filter(Boolean);

  return {
    type: 'FeatureCollection',
    features,
  };
}

function renderMetrics() {
  const totalRules = state.rainZones.length + state.blockSegments.length + state.bannedStationIds.size;
  elements.totalRuleCount.textContent = String(totalRules);
  elements.rainCount.textContent = String(state.rainZones.length);
  elements.blockCount.textContent = String(state.blockSegments.length);
  elements.selectedBannedCount.textContent = String(state.bannedStationIds.size);
  elements.bannedCount.textContent = String(state.bannedStationIds.size);
  elements.lineCount.textContent = String(state.network?.lines?.length || 0);
  elements.stationCount.textContent = String(state.network?.stations?.length || 0);
  elements.segmentCount.textContent = String(state.network?.segments?.length || 0);

  const sourceLabel = state.gis?.source?.startsWith('qgis_geojson')
    ? 'QGIS GeoJSON'
    : 'Fallback projection';
  const basemapLabel = state.gis?.basemap?.enabled ? 'MBTiles raster' : 'OSM raster';
  elements.networkSourceLabel.textContent = `${sourceLabel} + ${basemapLabel}`;
}

function updateMapHelper() {
  if (!elements.mapHelper) {
    return;
  }
  if (!state.temporaryPoint) {
    elements.mapHelper.textContent =
      state.mode === 'rain'
        ? 'Rain mode: click center, then click again to define radius.'
        : 'Block mode: click one point for a blocked point, or click two points for a blocked segment.';
    return;
  }

  elements.mapHelper.textContent =
    state.mode === 'rain'
      ? `Rain center locked at ${formatLonLat(state.temporaryPoint)}. Click again to finish the zone.`
      : `Block start locked at ${formatLonLat(state.temporaryPoint)}. Click again to finish or near the same point to drop a blocked point.`;
}

function buildPayloadPreview() {
  return {
    source: state.gis?.source || null,
    generated_at: new Date().toISOString(),
    ui_mode: state.mode,
    map_bounds: {
      min_lon: roundTo6(state.mapBounds[0]),
      min_lat: roundTo6(state.mapBounds[1]),
      max_lon: roundTo6(state.mapBounds[2]),
      max_lat: roundTo6(state.mapBounds[3]),
    },
    rain_zones: state.rainZones.map((zone, index) => ({
      id: `rain-${index + 1}`,
      center: {
        lon: roundTo6(zone.center.lon),
        lat: roundTo6(zone.center.lat),
        normalized: toNormalized(zone.center),
      },
      radius_m: zone.radius_m,
    })),
    block_segments: state.blockSegments.map((segment, index) => ({
      id: `block-${index + 1}`,
      kind: segment.kind,
      from: {
        lon: roundTo6(segment.from.lon),
        lat: roundTo6(segment.from.lat),
        normalized: toNormalized(segment.from),
      },
      to: {
        lon: roundTo6(segment.to.lon),
        lat: roundTo6(segment.to.lat),
        normalized: toNormalized(segment.to),
      },
    })),
    banned_stations: [...state.bannedStationIds].map((stationId) => {
      const station = state.stationById.get(stationId);
      const coordinates = state.stationCoordsById.get(stationId);
      return {
        id: stationId,
        name: station?.name || stationId,
        lon: coordinates ? roundTo6(coordinates[0]) : null,
        lat: coordinates ? roundTo6(coordinates[1]) : null,
      };
    }),
  };
}

function updateRulesSummary() {
  const payload = buildPayloadPreview();
  elements.rulesSummary.textContent = JSON.stringify(payload, null, 2);
  persistSession(payload);
}

function renderActivityFeed() {
  if (!state.activityFeed.length) {
    elements.activityFeed.innerHTML = `
      <article class="feed-item empty-feed">
        <strong>No actions yet</strong>
        <span>Add the first rule to start the session log.</span>
      </article>
    `;
    return;
  }

  elements.activityFeed.innerHTML = state.activityFeed
    .map(
      (item) => `
        <article class="feed-item">
          <strong>${escapeHtml(item.title)} · ${escapeHtml(item.createdAt)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </article>
      `
    )
    .join('');
}

function addFeed(title, detail) {
  state.activityFeed.unshift({
    title,
    detail,
    createdAt: new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  });
  state.activityFeed = state.activityFeed.slice(0, FEED_LIMIT);
  renderActivityFeed();
}

function initBannedStationSelector() {
  elements.bannedStations.innerHTML = '';
  for (const station of state.network.stations) {
    const option = document.createElement('option');
    option.value = station.id;
    option.textContent = `${station.name} (${station.id})`;
    elements.bannedStations.appendChild(option);
  }
}

function applyHydratedSelections() {
  for (const option of elements.bannedStations.options) {
    option.selected = state.bannedStationIds.has(option.value);
  }
}

function hydrateSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    state.rainZones = Array.isArray(saved.rain_zones)
      ? saved.rain_zones
          .map((zone) => ({
            center: {
              lon: Number(zone.center?.lon),
              lat: Number(zone.center?.lat),
            },
            radius_m: Number(zone.radius_m || 0),
          }))
          .filter((zone) => Number.isFinite(zone.center.lon) && Number.isFinite(zone.center.lat))
      : [];

    state.blockSegments = Array.isArray(saved.block_segments)
      ? saved.block_segments
          .map((segment) => ({
            kind: segment.kind === 'point' ? 'point' : 'line',
            from: {
              lon: Number(segment.from?.lon),
              lat: Number(segment.from?.lat),
            },
            to: {
              lon: Number(segment.to?.lon),
              lat: Number(segment.to?.lat),
            },
          }))
          .filter(
            (segment) =>
              Number.isFinite(segment.from.lon) &&
              Number.isFinite(segment.from.lat) &&
              Number.isFinite(segment.to.lon) &&
              Number.isFinite(segment.to.lat)
          )
      : [];

    state.bannedStationIds = new Set(
      Array.isArray(saved.banned_stations) ? saved.banned_stations.map((item) => item.id) : []
    );
  } catch (error) {
    console.warn('Unable to restore admin GIS session', error);
  }
}

function persistSession(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist admin GIS session', error);
  }
}

async function exportRules() {
  const payload = JSON.stringify(buildPayloadPreview(), null, 2);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload);
      addFeed('JSON exported', 'Rule payload copied to clipboard.');
      setStatus('Rule payload copied to clipboard.');
      return;
    }
  } catch (error) {
    console.warn('Clipboard export failed', error);
  }

  addFeed('JSON export fallback', 'Clipboard is unavailable. Use the preview panel instead.');
  setStatus('Clipboard is unavailable. Use the payload preview panel.');
}

function toNormalized(point) {
  const [minLon, minLat, maxLon, maxLat] = state.mapBounds;
  const lonSpan = maxLon - minLon || 1;
  const latSpan = maxLat - minLat || 1;
  return {
    x: roundTo6((point.lon - minLon) / lonSpan),
    y: roundTo6((maxLat - point.lat) / latSpan),
  };
}

function buildCirclePolygon(centerLon, centerLat, radiusM, steps) {
  const coordinates = [];
  const latRadius = radiusM / 111320;
  const lonRadius = radiusM / (111320 * Math.cos((centerLat * Math.PI) / 180) || 1);

  for (let step = 0; step <= steps; step += 1) {
    const theta = (step / steps) * Math.PI * 2;
    coordinates.push([
      roundTo6(centerLon + lonRadius * Math.cos(theta)),
      roundTo6(centerLat + latRadius * Math.sin(theta)),
    ]);
  }

  return coordinates;
}

function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const earthRadiusM = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1e-12, 1 - a)));
  return earthRadiusM * c;
}

function formatLonLat(point) {
  return `${point.lon.toFixed(5)}, ${point.lat.toFixed(5)}`;
}

function setStatus(text) {
  elements.statusText.textContent = text;
}

function roundTo6(value) {
  return Math.round(value * 1000000) / 1000000;
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

init();

const state = {
  network: null,
  startPoint: null,
  endPoint: null,
  pickMode: "start",
  routeResult: null,
  realMapRaster: null,
  pointLineHints: {
    start: [],
    end: [],
  },
  stationLookup: new Map(),
  lineLookup: new Map(),
  projectedStations: new Map(),
  nativeDiagramStations: new Map(),
  resolvedDiagramStations: new Map(),
  nativeDiagramTracks: {
    byId: new Map(),
    adjacencyByClass: new Map(),
    classColors: new Map(),
    pointsByClass: new Map(),
    trackIdsByClass: new Map(),
  },
  nativeLineClassLookup: new Map(),
  diagramSvgUrl: null,
  lineColorEntries: [],
  zoomControllers: {},
  viaStationIds: [],
};

const REAL_DRAW = {
  anchorRadius: 18,
  pointRadius: 42,
  labelOffsetX: 26,
  labelOffsetY: 18,
};

const DIAGRAM_DRAW = {
  stationRadius: 1.6,
  segmentWidth: 14,
};

const ZOOM = {
  minScale: 1,
  maxScale: 6,
  step: 1.16,
  wheelSensitivity: 0.0016,
  minWheelFactor: 0.86,
  maxWheelFactor: 1.16,
  animationMs: 150,
  dragThreshold: 6,
  realMapLabelScaleThreshold: 2.3,
};

const elements = {
  armStartBtn: document.getElementById("armStartBtn"),
  armEndBtn: document.getElementById("armEndBtn"),
  findRouteBtn: document.getElementById("findRouteBtn"),
  resetBtn: document.getElementById("resetBtn"),
  statusText: document.getElementById("statusText"),
  pickModeBadge: document.getElementById("pickModeBadge"),
  selectionMeta: document.getElementById("selectionMeta"),
  summary: document.getElementById("summary"),
  steps: document.getElementById("steps"),
  viaStationSelect: document.getElementById("viaStationSelect"),
  addViaStationBtn: document.getElementById("addViaStationBtn"),
  clearViaStationsBtn: document.getElementById("clearViaStationsBtn"),
  viaStationList: document.getElementById("viaStationList"),
  realMapSurface: document.getElementById("realMapSurface"),
  realMapStage: document.getElementById("realMapStage"),
  realMapImage: document.getElementById("realMapImage"),
  realMapOverlay: document.getElementById("realMapOverlay"),
  diagramSurface: document.getElementById("diagramSurface"),
  diagramStage: document.getElementById("diagramStage"),
  diagramDocument: document.getElementById("diagramDocument"),
  diagramOverlay: document.getElementById("diagramOverlay"),
  zoomButtons: document.querySelectorAll("[data-zoom-target] [data-zoom-action]"),
};

async function init() {
  try {
    setStatus("Loading subway network...");
    const response = await fetch("/api/network");
    const body = await readApiResponse(response);
    if (!response.ok) {
      throw new Error(body.detail || "Failed to load subway network.");
    }

    state.network = body;
    buildLookups();
    await configureMapSurfaces();
    bindEvents();
    initZoomControllers();
    renderAll();
    setStatus("Pick a start point on the real map.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to load subway network.");
  }
}

function buildLookups() {
  state.stationLookup.clear();
  state.lineLookup.clear();
  state.lineColorEntries = [];

  state.network.stations.forEach((station) => {
    state.stationLookup.set(station.id, station);
  });
  refreshProjectedStations();

  state.network.lines.forEach((line) => {
    state.lineLookup.set(line.id, line);
    if (!state.network.map.supports_line_hints) {
      return;
    }
    const rgb = parseColor(line.color);
    if (!rgb || colorSaturation(rgb) < 0.18) {
      return;
    }
    state.lineColorEntries.push({
      id: line.id,
      name: line.name,
      rgb,
    });
  });

  renderViaStationSelector();
}

function refreshProjectedStations() {
  state.projectedStations.clear();
  state.network.stations.forEach((station) => {
    state.projectedStations.set(station.id, projectToDiagram(station));
  });
}

async function configureMapSurfaces() {
  const realMap = state.network.map;
  const diagram = state.network.diagram;

  elements.realMapImage.src = realMap.image_url;

  elements.realMapSurface.style.aspectRatio = `${realMap.width} / ${realMap.height}`;
  elements.diagramSurface.style.aspectRatio = `${diagram.width} / ${diagram.height}`;

  elements.realMapOverlay.setAttribute("viewBox", `0 0 ${realMap.width} ${realMap.height}`);
  elements.diagramOverlay.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);
  await Promise.all([
    ensureImageLoaded(elements.realMapImage),
    ensureDiagramDocument(diagram.svg_url),
  ]);
  if (realMap.supports_line_hints) {
    buildRealMapRaster();
  } else {
    state.realMapRaster = null;
  }
}

function bindEvents() {
  elements.armStartBtn.addEventListener("click", () => setPickMode("start"));
  elements.armEndBtn.addEventListener("click", () => setPickMode("end"));
  elements.findRouteBtn.addEventListener("click", findRouteForPoints);
  elements.resetBtn.addEventListener("click", resetRouteState);
  elements.addViaStationBtn.addEventListener("click", addViaStationFromSelector);
  elements.clearViaStationsBtn.addEventListener("click", clearViaStations);
  elements.zoomButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.zoomAction;
      const target = button.closest("[data-zoom-target]")?.dataset.zoomTarget;
      if (!action || !target) {
        return;
      }
      runZoomAction(target, action);
    });
  });
  window.addEventListener("resize", handleWindowResize);
}

function renderViaStationSelector() {
  if (!elements.viaStationSelect) {
    return;
  }

  const selectedValue = elements.viaStationSelect.value;
  const options = state.network.stations
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((station) => {
      const isSelected = station.id === selectedValue ? ' selected="selected"' : "";
      return `<option value="${station.id}"${isSelected}>${escapeHtml(station.name)} (${escapeHtml(station.id)})</option>`;
    })
    .join("");

  elements.viaStationSelect.innerHTML = options;
}

function addViaStationFromSelector() {
  const stationId = elements.viaStationSelect?.value;
  if (!stationId) {
    return;
  }

  if (state.viaStationIds.includes(stationId)) {
    setStatus("This stopover station is already in the list.");
    return;
  }

  state.viaStationIds.push(stationId);
  state.routeResult = null;
  renderViaStations();
  renderSelectionMeta();
  renderSummary();
  renderSteps();
  setStatus("Stopover added. Re-run route search to apply.");
}

function clearViaStations() {
  if (!state.viaStationIds.length) {
    return;
  }

  state.viaStationIds = [];
  state.routeResult = null;
  renderViaStations();
  renderSelectionMeta();
  renderSummary();
  renderSteps();
  setStatus("Stopovers cleared.");
}

function removeViaStation(stationId) {
  state.viaStationIds = state.viaStationIds.filter((currentStationId) => currentStationId !== stationId);
  state.routeResult = null;
  renderViaStations();
  renderSelectionMeta();
  renderSummary();
  renderSteps();
  setStatus("Stopover removed. Re-run route search to apply.");
}

function renderViaStations() {
  if (!elements.viaStationList) {
    return;
  }

  if (!state.viaStationIds.length) {
    elements.viaStationList.classList.add("empty");
    elements.viaStationList.textContent = "No stopovers selected.";
    return;
  }

  elements.viaStationList.classList.remove("empty");
  elements.viaStationList.innerHTML = state.viaStationIds
    .map((stationId, index) => {
      const station = state.stationLookup.get(stationId);
      const label = station ? `${station.name} (${station.id})` : stationId;
      return `
        <div class="via-station-row">
          <span>${index + 1}. ${escapeHtml(label)}</span>
          <button class="secondary via-remove-btn" type="button" data-via-station-id="${stationId}">Remove</button>
        </div>
      `;
    })
    .join("");

  elements.viaStationList.querySelectorAll("[data-via-station-id]").forEach((button) => {
    button.addEventListener("click", () => {
      removeViaStation(button.dataset.viaStationId);
    });
  });
}

function setPickMode(mode) {
  state.pickMode = mode;
  updatePickModeUi();
  setStatus(
    mode === "start"
      ? "Click on the real map to place the start point."
      : "Click on the real map to place the end point.",
  );
}

function updatePickModeUi() {
  const isStart = state.pickMode === "start";
  elements.armStartBtn.classList.toggle("active", isStart);
  elements.armEndBtn.classList.toggle("active", !isStart);
  elements.pickModeBadge.textContent = isStart ? "Start point" : "End point";
}

function selectRealMapPointFromEvent(event) {
  const controller = state.zoomControllers.real;
  const point = eventToMapPoint(
    event,
    elements.realMapSurface,
    controller,
    state.network.map.width,
    state.network.map.height,
  );

  if (state.pickMode === "start") {
    state.startPoint = point;
    state.routeResult = null;
    if (!state.endPoint) {
      state.pickMode = "end";
    }
  } else {
    state.endPoint = point;
    state.routeResult = null;
  }

  updatePointLineHints();
  renderAll();
  setStatus("Point updated. Run the route search when both points are ready.");
}

async function findRouteForPoints() {
  if (!state.startPoint || !state.endPoint) {
    setStatus("You need both a start point and an end point.");
    return;
  }

  setStatus("Calculating optimal route...");

  try {
    const payload = {
      start_x: state.startPoint.x,
      start_y: state.startPoint.y,
      end_x: state.endPoint.x,
      end_y: state.endPoint.y,
      walking_seconds_per_pixel: 1.0,
      via_station_ids: state.viaStationIds,
    };
    if (state.network.map.supports_line_hints) {
      payload.start_preferred_line_ids = state.pointLineHints.start;
      payload.end_preferred_line_ids = state.pointLineHints.end;
    }
    const response = await fetch("/api/route/points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await readApiResponse(response);
    if (!response.ok) {
      throw new Error(body.detail || "No route found for the selected points.");
    }

    state.routeResult = body;
    renderAll();
    setStatus("Route ready. The SVG overlay is now highlighting the selected path.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to calculate route.");
  }
}

async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {
      detail: raw.trim() || `HTTP ${response.status}`,
    };
  }
}

async function ensureDiagramDocument(svgUrl) {
  if (state.diagramSvgUrl === svgUrl && state.nativeDiagramStations.size > 0) {
    resolveNativeDiagramMapping();
    return;
  }

  const response = await fetch(svgUrl);
  if (!response.ok) {
    throw new Error("Failed to load the subway SVG document.");
  }

  const markup = await response.text();
  elements.diagramDocument.innerHTML = markup;

  const svgRoot = elements.diagramDocument.querySelector("svg");
  if (!svgRoot) {
    throw new Error("Invalid subway SVG document.");
  }

  svgRoot.classList.add("route-native-diagram");
  svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
  splitInteractiveTracksAtStations(svgRoot);
  state.nativeDiagramTracks = buildNativeDiagramTracks(svgRoot);
  state.nativeDiagramStations = buildNativeDiagramStations(svgRoot, state.nativeDiagramTracks);
  state.diagramSvgUrl = svgUrl;
  resolveNativeDiagramMapping();
}

function splitInteractiveTracksAtStations(svgRoot) {
  const stationPoints = extractDiagramStationPoints(svgRoot);
  const trackNodes = [...svgRoot.querySelectorAll(".interactive-track")];
  const splitThreshold = 1.2;
  let generatedCount = 0;

  trackNodes.forEach((trackNode) => {
    const lineClass = trackNode.dataset.lineClass || Array.from(trackNode.classList).find((value) => /^c\d+$/.test(value));
    const x1 = Number(trackNode.getAttribute("x1") || 0);
    const y1 = Number(trackNode.getAttribute("y1") || 0);
    const x2 = Number(trackNode.getAttribute("x2") || 0);
    const y2 = Number(trackNode.getAttribute("y2") || 0);
    const baseId = trackNode.id || `track-auto-${generatedCount}`;
    const segmentLength = Math.hypot(x2 - x1, y2 - y1);

    if (!segmentLength) {
      return;
    }

    const splitPoints = [
      { t: 0, x: x1, y: y1 },
      { t: 1, x: x2, y: y2 },
    ];

    stationPoints.forEach((stationPoint) => {
      const projection = projectPointOntoSegment(
        { x: stationPoint.x, y: stationPoint.y },
        { x1, y1, x2, y2 },
      );
      const distance = Math.hypot(projection.x - stationPoint.x, projection.y - stationPoint.y);
      if (distance > splitThreshold) {
        return;
      }
      splitPoints.push({
        t: projection.ratio,
        x: projection.x,
        y: projection.y,
      });
    });

    const normalizedPoints = dedupeSplitPoints(splitPoints);
    if (normalizedPoints.length <= 2) {
      return;
    }

    const fragment = document.createDocumentFragment();
    normalizedPoints.forEach((point, index) => {
      const nextPoint = normalizedPoints[index + 1];
      if (!nextPoint) {
        return;
      }
      const subLength = Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);
      if (subLength <= 0.15) {
        return;
      }
      const clone = trackNode.cloneNode(false);
      clone.id = `${baseId}__${index}`;
      if (lineClass) {
        clone.dataset.lineClass = lineClass;
      }
      clone.setAttribute("x1", roundToThreeDecimals(point.x));
      clone.setAttribute("y1", roundToThreeDecimals(point.y));
      clone.setAttribute("x2", roundToThreeDecimals(nextPoint.x));
      clone.setAttribute("y2", roundToThreeDecimals(nextPoint.y));
      fragment.appendChild(clone);
      generatedCount += 1;
    });

    trackNode.replaceWith(fragment);
  });
}

function extractDiagramStationPoints(svgRoot) {
  return [...svgRoot.querySelectorAll(".station-node .station-marker")]
    .map((marker) => ({
      x: Number(marker.getAttribute("x") || 0),
      y: Number(marker.getAttribute("y") || 0),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function dedupeSplitPoints(points) {
  const uniquePoints = [];
  points
    .sort((left, right) => left.t - right.t)
    .forEach((point) => {
      const lastPoint = uniquePoints[uniquePoints.length - 1];
      if (lastPoint && Math.abs(lastPoint.t - point.t) < 0.01) {
        return;
      }
      uniquePoints.push(point);
    });
  return uniquePoints;
}

function buildNativeDiagramTracks(svgRoot) {
  const tracks = {
    byId: new Map(),
    adjacencyByClass: new Map(),
    classColors: new Map(),
    pointsByClass: new Map(),
    trackIdsByClass: new Map(),
  };

  svgRoot.querySelectorAll(".interactive-track").forEach((node) => {
    const id = node.id;
    const lineClass = node.dataset.lineClass || Array.from(node.classList).find((value) => /^c\d+$/.test(value));
    if (!id || !lineClass) {
      return;
    }

    const x1 = Number(node.getAttribute("x1") || 0);
    const y1 = Number(node.getAttribute("y1") || 0);
    const x2 = Number(node.getAttribute("x2") || 0);
    const y2 = Number(node.getAttribute("y2") || 0);
    const fromKey = pointKey(x1, y1);
    const toKey = pointKey(x2, y2);
    const length = Math.hypot(x2 - x1, y2 - y1);

    tracks.byId.set(id, {
      id,
      node,
      lineClass,
      fromKey,
      toKey,
      x1,
      y1,
      x2,
      y2,
      length,
    });

    if (!tracks.classColors.has(lineClass)) {
      tracks.classColors.set(lineClass, parseColor(getComputedStyle(node).stroke));
    }

    addTrackAdjacency(tracks.adjacencyByClass, lineClass, fromKey, toKey, id, length);
    addTrackAdjacency(tracks.adjacencyByClass, lineClass, toKey, fromKey, id, length);
    addTrackPoint(tracks.pointsByClass, lineClass, fromKey, x1, y1);
    addTrackPoint(tracks.pointsByClass, lineClass, toKey, x2, y2);

    if (!tracks.trackIdsByClass.has(lineClass)) {
      tracks.trackIdsByClass.set(lineClass, new Set());
    }
    tracks.trackIdsByClass.get(lineClass).add(id);
  });

  return tracks;
}

function addTrackAdjacency(adjacencyByClass, lineClass, fromKey, toKey, trackId, weight) {
  if (!adjacencyByClass.has(lineClass)) {
    adjacencyByClass.set(lineClass, new Map());
  }
  const lineAdjacency = adjacencyByClass.get(lineClass);
  if (!lineAdjacency.has(fromKey)) {
    lineAdjacency.set(fromKey, []);
  }
  lineAdjacency.get(fromKey).push({ toKey, trackId, weight });
}

function addTrackPoint(pointsByClass, lineClass, key, x, y) {
  if (!pointsByClass.has(lineClass)) {
    pointsByClass.set(lineClass, new Map());
  }
  if (!pointsByClass.get(lineClass).has(key)) {
    pointsByClass.get(lineClass).set(key, { key, x, y });
  }
}

function buildNativeDiagramStations(svgRoot, nativeTracks) {
  const lookup = new Map();

  svgRoot.querySelectorAll(".station-node").forEach((node) => {
    const marker = node.querySelector(".station-marker");
    const key = normalizeStationKey(node.getAttribute("data-station-name") || node.id || "");
    if (!marker || !key) {
      return;
    }

    const x = Number(marker.getAttribute("x") || 0);
    const y = Number(marker.getAttribute("y") || 0);
    const stationPointKey = pointKey(x, y);
    const incidentLineClasses = getIncidentLineClassesForPoint(nativeTracks, { x, y });
    const attachmentPointKeysByLineClass = getStationAttachmentPointKeysByLineClass(
      nativeTracks,
      { x, y },
      incidentLineClasses,
    );
    attachmentPointKeysByLineClass.forEach((_, lineClass) => {
      incidentLineClasses.add(lineClass);
    });

    if (!lookup.has(key)) {
      lookup.set(key, []);
    }
    lookup.get(key).push({
      node,
      x,
      y,
      pointKey: stationPointKey,
      incidentLineClasses,
      attachmentPointKeysByLineClass,
    });
  });

  return lookup;
}

function getStationAttachmentPointKeysByLineClass(nativeTracks, point, incidentLineClasses) {
  const attachmentPointKeysByLineClass = new Map();
  const lineClasses = incidentLineClasses?.size
    ? [...incidentLineClasses]
    : [...nativeTracks.pointsByClass.keys()];
  const attachmentThreshold = 1.6;
  const exactAttachmentThreshold = 0.35;
  const nearestAttachmentSlack = 0.05;

  lineClasses.forEach((lineClass) => {
    const points = nativeTracks.pointsByClass.get(lineClass);
    if (!points?.size) {
      return;
    }

    const matches = [];
    points.forEach((candidatePoint, key) => {
      const distance = Math.hypot(candidatePoint.x - point.x, candidatePoint.y - point.y);
      if (distance <= attachmentThreshold) {
        matches.push({ key, distance });
      }
    });

    matches.sort((left, right) => left.distance - right.distance || left.key.localeCompare(right.key));
    if (matches.length) {
      const bestDistance = matches[0].distance;
      const retainedMatches = matches.filter(
        (entry) => entry.distance <= (
          bestDistance <= exactAttachmentThreshold
            ? exactAttachmentThreshold
            : bestDistance + nearestAttachmentSlack
        ),
      );
      attachmentPointKeysByLineClass.set(
        lineClass,
        [...new Set(retainedMatches.map((entry) => entry.key))],
      );
      return;
    }

    const fallbackAttachment = findNearestTrackAttachmentForTracks(nativeTracks, lineClass, point);
    if (!fallbackAttachment) {
      return;
    }
    attachmentPointKeysByLineClass.set(
      lineClass,
      [...new Set([fallbackAttachment.fromKey, fallbackAttachment.toKey])],
    );
  });

  return attachmentPointKeysByLineClass;
}

function resolveNativeDiagramMapping() {
  state.nativeLineClassLookup.clear();
  state.resolvedDiagramStations.clear();

  resolveNativeLineClasses();

  state.network.stations.forEach((station) => {
    const resolvedStation = resolveNativeStation(station);
    if (resolvedStation) {
      state.resolvedDiagramStations.set(station.id, resolvedStation);
    }
  });

  refreshProjectedStations();
}

function resolveNativeLineClasses() {
  const availableClasses = Array.from(state.nativeDiagramTracks.classColors.entries())
    .map(([lineClass, color]) => ({ lineClass, color }))
    .filter((entry) => entry.color);
  const claimedClasses = new Set();

  state.network.lines.forEach((line) => {
    const targetColor = parseColor(line.color);
    if (!targetColor) {
      return;
    }

    let bestMatch = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    availableClasses.forEach((entry) => {
      const distance = colorDistance(targetColor, entry.color) + (claimedClasses.has(entry.lineClass) ? 10_000 : 0);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = entry.lineClass;
      }
    });

    if (bestMatch) {
      claimedClasses.add(bestMatch);
      state.nativeLineClassLookup.set(line.id, bestMatch);
    }
  });
}

function resolveNativeStation(station) {
  const candidates = state.nativeDiagramStations.get(normalizeStationKey(station.name)) || [];
  if (!candidates.length) {
    return null;
  }

  const approximatePoint = getApproximateDiagramPoint(station);
  const preferredLineClasses = new Set(
    (station.line_ids || [])
      .map((lineId) => state.nativeLineClassLookup.get(lineId))
      .filter(Boolean),
  );

  let bestCandidate = null;
  let bestScore = null;

  candidates.forEach((candidate) => {
    let lineOverlap = 0;
    preferredLineClasses.forEach((lineClass) => {
      if (
        candidate.attachmentPointKeysByLineClass?.has(lineClass)
        || candidate.incidentLineClasses.has(lineClass)
      ) {
        lineOverlap += 1;
      }
    });

    const distance = Math.hypot(candidate.x - approximatePoint.x, candidate.y - approximatePoint.y);
    const score = [-lineOverlap, distance, candidate.node.id];

    if (!bestScore || compareTuple(score, bestScore) < 0) {
      bestCandidate = candidate;
      bestScore = score;
    }
  });

  return bestCandidate;
}

function resetRouteState() {
  state.startPoint = null;
  state.endPoint = null;
  state.pickMode = "start";
  state.routeResult = null;
  state.viaStationIds = [];
  state.pointLineHints.start = [];
  state.pointLineHints.end = [];
  resetAllZoom();
  renderAll();
  setStatus("Reset complete. Click on the map to place a new start point.");
}

function renderAll() {
  updatePickModeUi();
  renderRealMap();
  renderDiagram();
  renderViaStations();
  renderSelectionMeta();
  renderSummary();
  renderSteps();
}

function renderRealMap() {
  const route = state.routeResult;
  const selectedStartStation = route?.selected_start_station;
  const selectedEndStation = route?.selected_end_station;
  const activeStationIds = new Set(route?.route?.station_ids || []);

  const stationMarkup = state.network.stations
    .map((station) =>
      renderRealStationAnchor(
        station,
        station.id === selectedStartStation?.id || station.id === selectedEndStation?.id,
        activeStationIds.has(station.id),
      ),
    )
    .join("");
  const routeMarkup = renderRealRouteSegments(route?.route);

  const connectorMarkup = [
    renderWalkingConnector(state.startPoint, selectedStartStation),
    renderWalkingConnector(state.endPoint, selectedEndStation),
  ]
    .filter(Boolean)
    .join("");

  const pointMarkup = [
    renderPickedPoint(state.startPoint, "A", "start"),
    renderPickedPoint(state.endPoint, "B", "end"),
  ]
    .filter(Boolean)
    .join("");

  elements.realMapOverlay.innerHTML = `
    <g class="real-route">${routeMarkup}</g>
    <g class="real-connectors">${connectorMarkup}</g>
    <g class="real-stations">${stationMarkup}</g>
    <g class="real-points">${pointMarkup}</g>
  `;
}

function renderRealStationAnchor(station, isSelected, isRouteActive) {
  const nodeClasses = ["real-station-node"];
  if (isRouteActive) {
    nodeClasses.push("is-route-active");
  }
  if (isSelected) {
    nodeClasses.push("is-selected");
  }

  const classes = ["real-station-anchor"];
  if (isRouteActive) {
    classes.push("is-route-active");
  }
  if (isSelected) {
    classes.push("is-selected");
  }

  return `
    <g class="${nodeClasses.join(" ")}">
      <circle
        class="${classes.join(" ")}"
        cx="${station.x}"
        cy="${station.y}"
        r="${REAL_DRAW.anchorRadius}"
      ></circle>
      <text
        class="real-station-label"
        x="${station.x + REAL_DRAW.labelOffsetX}"
        y="${station.y - REAL_DRAW.labelOffsetY}"
      >${escapeHtml(station.name)}</text>
    </g>
  `;
}

function renderRealRouteSegments(routePayload) {
  if (!routePayload?.steps?.length) {
    return "";
  }

  return routePayload.steps
    .map((step) => renderRealRouteSegment(step))
    .filter(Boolean)
    .join("");
}

function renderRealRouteSegment(step) {
  if (step.kind === "transfer" || !step.next_station_id) {
    return "";
  }

  const fromStation = state.stationLookup.get(step.station_id);
  const toStation = state.stationLookup.get(step.next_station_id);
  if (!fromStation || !toStation) {
    return "";
  }

  const kindClass = step.kind === "walk" ? "is-walk" : "is-ride";
  return `
    <line
      class="real-route-segment ${kindClass}"
      x1="${fromStation.x}"
      y1="${fromStation.y}"
      x2="${toStation.x}"
      y2="${toStation.y}"
    ></line>
  `;
}

function renderWalkingConnector(point, station) {
  if (!point || !station) {
    return "";
  }

  return `
    <line
      class="walking-connector"
      x1="${point.x}"
      y1="${point.y}"
      x2="${station.x}"
      y2="${station.y}"
    ></line>
  `;
}

function renderPickedPoint(point, label, kind) {
  if (!point) {
    return "";
  }

  return `
    <g class="pick-point ${kind}">
      <circle cx="${point.x}" cy="${point.y}" r="${REAL_DRAW.pointRadius}"></circle>
      <text x="${point.x}" y="${point.y}">${label}</text>
    </g>
  `;
}

function renderDiagram() {
  const hasRoute = Boolean(state.routeResult);
  const activeStationIds = new Set(state.routeResult?.route.station_ids || []);
  const transferStationIds = new Set(
    (state.routeResult?.route.steps || [])
      .filter((step) => step.kind === "transfer" || step.kind === "walk")
      .map((step) => step.station_id),
  );
  const activeTrackIds = collectActiveNativeTrackIds(state.routeResult);

  const stationMarkup = (state.routeResult?.route.station_ids || [])
    .map((stationId) => state.stationLookup.get(stationId))
    .filter((station) => station && !getNativeDiagramStation(station))
    .map((station) =>
      renderDiagramStation(
        station,
        transferStationIds,
        state.routeResult?.selected_start_station?.id,
        state.routeResult?.selected_end_station?.id,
      ),
    )
    .join("");

  elements.diagramOverlay.innerHTML = `
    <g class="diagram-stations">${stationMarkup}</g>
  `;
  updateNativeDiagramHighlights(
    hasRoute,
    activeTrackIds,
    activeStationIds,
    transferStationIds,
    state.routeResult?.selected_start_station?.id,
    state.routeResult?.selected_end_station?.id,
  );
}

function renderDiagramStation(
  station,
  transferStationIds,
  selectedStartStationId,
  selectedEndStationId,
) {
  const point = state.projectedStations.get(station.id);
  const classes = ["diagram-station"];

  if (transferStationIds.has(station.id)) {
    classes.push("is-transfer");
  }
  if (station.id === selectedStartStationId) {
    classes.push("is-entry");
  }
  if (station.id === selectedEndStationId) {
    classes.push("is-exit");
  }

  return `
    <g id="${stationDomId(station.id)}" class="${classes.join(" ")}">
      <circle class="station-shell" cx="${point.x}" cy="${point.y}" r="${DIAGRAM_DRAW.stationRadius + 4}"></circle>
      <circle class="station-core" cx="${point.x}" cy="${point.y}" r="${DIAGRAM_DRAW.stationRadius}"></circle>
    </g>
  `;
}

function updateNativeDiagramHighlights(
  hasRoute,
  activeTrackIds,
  activeStationIds,
  transferStationIds,
  selectedStartStationId,
  selectedEndStationId,
) {
  const svgRoot = elements.diagramDocument.querySelector("svg");
  if (!svgRoot) {
    return;
  }

  svgRoot.querySelectorAll(".station-node").forEach((node) => {
    node.classList.remove(
      "is-route-dimmed",
      "is-route-active",
      "is-route-transfer",
      "is-route-entry",
      "is-route-exit",
    );
    if (hasRoute) {
      node.classList.add("is-route-dimmed");
    }
  });

  svgRoot.querySelectorAll(".interactive-track").forEach((node) => {
    node.classList.remove("is-route-dimmed", "is-route-active");
    if (hasRoute) {
      node.classList.add("is-route-dimmed");
    }
  });

  activeTrackIds.forEach((trackId) => {
    const track = state.nativeDiagramTracks.byId.get(trackId);
    if (!track) {
      return;
    }
    track.node.classList.remove("is-route-dimmed");
    track.node.classList.add("is-route-active");
  });

  state.network.stations.forEach((station) => {
    const nativeStation = getNativeDiagramStation(station);
    if (!nativeStation) {
      return;
    }

    if (!activeStationIds.has(station.id)) {
      return;
    }

    nativeStation.node.classList.remove("is-route-dimmed");
    nativeStation.node.classList.add("is-route-active");
    if (transferStationIds.has(station.id)) {
      nativeStation.node.classList.add("is-route-transfer");
    }
    if (station.id === selectedStartStationId) {
      nativeStation.node.classList.add("is-route-entry");
    }
    if (station.id === selectedEndStationId) {
      nativeStation.node.classList.add("is-route-exit");
    }
  });
}

function getNativeDiagramStation(station) {
  return (
    state.resolvedDiagramStations.get(station.id)
    || state.nativeDiagramStations.get(normalizeStationKey(station.name))?.[0]
    || null
  );
}

function getNativeDiagramStationForLine(station, lineId) {
  const lineClass = state.nativeLineClassLookup.get(lineId);
  if (!lineClass) {
    return getNativeDiagramStation(station);
  }

  const candidates = state.nativeDiagramStations.get(normalizeStationKey(station.name)) || [];
  const matchingCandidates = candidates.filter(
    (candidate) => candidate.attachmentPointKeysByLineClass?.has(lineClass),
  );

  if (!matchingCandidates.length) {
    return getNativeDiagramStation(station);
  }

  const approximatePoint = getApproximateDiagramPoint(station);
  let bestCandidate = null;
  let bestScore = null;

  matchingCandidates.forEach((candidate) => {
    const distance = Math.hypot(candidate.x - approximatePoint.x, candidate.y - approximatePoint.y);
    const attachmentCount = candidate.attachmentPointKeysByLineClass.get(lineClass)?.length || 0;
    const score = [distance, -attachmentCount, candidate.node.id];

    if (!bestScore || compareTuple(score, bestScore) < 0) {
      bestCandidate = candidate;
      bestScore = score;
    }
  });

  return bestCandidate || getNativeDiagramStation(station);
}

function renderSelectionMeta() {
  const blocks = [];

  if (state.startPoint) {
    blocks.push(renderMetricCard("Start point", formatPoint(state.startPoint)));
  }
  if (state.pointLineHints.start.length) {
    blocks.push(renderMetricCard("Start line hint", formatLineHints(state.pointLineHints.start)));
  }
  if (state.endPoint) {
    blocks.push(renderMetricCard("End point", formatPoint(state.endPoint)));
  }
  if (state.pointLineHints.end.length) {
    blocks.push(renderMetricCard("End line hint", formatLineHints(state.pointLineHints.end)));
  }
  if (state.routeResult) {
    blocks.push(
      renderMetricCard(
        "Entry station",
        `${state.routeResult.selected_start_station.name} (${state.routeResult.selected_start_station.id})`,
      ),
    );
    blocks.push(
      renderMetricCard(
        "Exit station",
        `${state.routeResult.selected_end_station.name} (${state.routeResult.selected_end_station.id})`,
      ),
    );
  }
  if (state.viaStationIds.length) {
    const viaLabel = state.viaStationIds
      .map((stationId) => state.stationLookup.get(stationId)?.name || stationId)
      .join(" -> ");
    blocks.push(renderMetricCard("Stopovers", viaLabel));
  }

  if (!blocks.length) {
    elements.selectionMeta.classList.add("empty");
    elements.selectionMeta.textContent = "Click on the map to place the first point.";
    return;
  }

  elements.selectionMeta.classList.remove("empty");
  elements.selectionMeta.innerHTML = blocks.join("");
}

function renderSummary() {
  if (!state.routeResult) {
    elements.summary.classList.add("empty");
    elements.summary.textContent = "No route has been calculated yet.";
    return;
  }

  const route = state.routeResult.route;
  const lineLabels = route.line_labels.length ? route.line_labels.join(" -> ") : "No train ride";
  const viaStations = state.routeResult.via_stations || [];
  const viaLabel = viaStations.length
    ? viaStations.map((station) => station.name).join(" -> ")
    : "None";

  elements.summary.classList.remove("empty");
  elements.summary.innerHTML = [
    renderMetricCard("Total journey", formatDuration(state.routeResult.total_journey_time_sec)),
    renderMetricCard("Subway time", formatDuration(route.total_time_sec)),
    renderMetricCard(
      "Walking",
      `${formatDuration(state.routeResult.access_walk_time_sec + state.routeResult.egress_walk_time_sec)}`,
    ),
    renderMetricCard(
      "Chosen stations",
      `${state.routeResult.selected_start_station.name} -> ${state.routeResult.selected_end_station.name}`,
    ),
    renderMetricCard("Stopovers", viaLabel),
    renderMetricCard("Line sequence", lineLabels),
  ].join("");
}

function renderSteps() {
  if (!state.routeResult) {
    elements.steps.innerHTML = '<li class="empty">Pick two points, then run the route search.</li>';
    return;
  }

  const result = state.routeResult;
  const items = [];

  items.push(
    renderStepCard(
      `Walk to ${result.selected_start_station.name}`,
      "From picked point",
      formatDuration(result.access_walk_time_sec),
      `${Math.round(result.access_walk_distance_px)} px`,
    ),
  );

  summarizeRouteSteps(result.route).forEach((step) => {
    items.push(renderStepCard(step.title, step.description, step.duration, step.badge));
  });

  items.push(
    renderStepCard(
      `Walk to destination from ${result.selected_end_station.name}`,
      "To picked point",
      formatDuration(result.egress_walk_time_sec),
      `${Math.round(result.egress_walk_distance_px)} px`,
    ),
  );

  elements.steps.innerHTML = items.join("");
}

function renderMetricCard(label, value) {
  return `
    <div class="summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderStepCard(title, description, duration, badge = "") {
  const badgeMarkup = badge
    ? `<span class="step-card__badge">${escapeHtml(badge)}</span>`
    : "";
  return `
    <li class="step-card">
      <div class="step-card__title-row">
        <strong>${escapeHtml(title)}</strong>
        <span class="step-card__duration">${escapeHtml(duration)}</span>
      </div>
      <div class="step-card__meta">
        <span class="step-card__description">${escapeHtml(description)}</span>
        ${badgeMarkup}
      </div>
    </li>
  `;
}

function summarizeRouteSteps(route) {
  const summaries = [];
  const steps = route?.steps || [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const line = state.lineLookup.get(step.line_id);
    const from = state.stationLookup.get(step.station_id)?.name || step.station_id;
    const to = state.stationLookup.get(step.next_station_id)?.name || step.next_station_id;

    if (step.kind === "ride") {
      let finalTo = to;
      let totalDuration = step.duration_sec;
      let stopCount = 1;
      let nextIndex = index + 1;

      while (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        if (nextStep.kind !== "ride" || nextStep.line_id !== step.line_id) {
          break;
        }
        totalDuration += nextStep.duration_sec;
        stopCount += 1;
        finalTo = state.stationLookup.get(nextStep.next_station_id)?.name || nextStep.next_station_id;
        nextIndex += 1;
      }

      summaries.push({
        title: `Ride ${line?.name || step.line_id}`,
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
        description: `Switch after ${line?.name || step.line_id}`,
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

function collectActiveNativeTrackIds(result) {
  const activeTrackIds = new Set();

  if (!result?.route?.steps?.length) {
    return activeTrackIds;
  }

  result.route.steps.forEach((step) => {
    if (step.kind !== "ride" || !step.next_station_id) {
      return;
    }

    const fromStation = state.stationLookup.get(step.station_id);
    const toStation = state.stationLookup.get(step.next_station_id);
    const lineClass = state.nativeLineClassLookup.get(step.line_id);
    if (!fromStation || !toStation || !lineClass) {
      return;
    }

    const fromPointKeys = getStationAttachmentPointKeys(fromStation, step.line_id);
    const toPointKeys = getStationAttachmentPointKeys(toStation, step.line_id);
    if (!fromPointKeys.length || !toPointKeys.length) {
      return;
    }

    const pathTrackIds = findNativeTrackRoute(lineClass, fromPointKeys, toPointKeys);
    pathTrackIds.forEach((trackId) => {
      activeTrackIds.add(trackId);
    });
  });

  return activeTrackIds;
}

function getStationAttachmentPointKeys(station, lineId) {
  const lineClass = state.nativeLineClassLookup.get(lineId);
  if (!lineClass) {
    return [];
  }

  const lineSpecificStation = getNativeDiagramStationForLine(station, lineId);
  const lineSpecificPointKeys = lineSpecificStation?.attachmentPointKeysByLineClass?.get(lineClass);
  if (lineSpecificPointKeys?.length) {
    return [...lineSpecificPointKeys];
  }

  const nativeStation = getNativeDiagramStation(station);
  const fallbackPointKeys = nativeStation?.attachmentPointKeysByLineClass?.get(lineClass);
  if (fallbackPointKeys?.length) {
    return [...fallbackPointKeys];
  }

  const targetPoint = nativeStation
    ? { x: nativeStation.x, y: nativeStation.y }
    : getApproximateDiagramPoint(station);
  const fallbackAttachment = findNearestTrackAttachment(lineClass, targetPoint);
  if (!fallbackAttachment) {
    return [];
  }

  return [...new Set([fallbackAttachment.fromKey, fallbackAttachment.toKey])];
}

function findNearestTrackAttachment(lineClass, targetPoint) {
  return findNearestTrackAttachmentForTracks(state.nativeDiagramTracks, lineClass, targetPoint);
}

function findNearestTrackAttachmentForTracks(nativeTracks, lineClass, targetPoint) {
  const trackIds = nativeTracks.trackIdsByClass.get(lineClass);
  if (!trackIds?.size) {
    return null;
  }

  let bestAttachment = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  trackIds.forEach((trackId) => {
    const track = nativeTracks.byId.get(trackId);
    if (!track) {
      return;
    }

    const projection = projectPointOntoSegment(targetPoint, track);
    const distance = Math.hypot(projection.x - targetPoint.x, projection.y - targetPoint.y);
    if (distance < bestDistance) {
      bestAttachment = {
        trackId,
        lineClass,
        x: projection.x,
        y: projection.y,
        fromKey: track.fromKey,
        toKey: track.toKey,
        distance,
        distanceToFrom: Math.hypot(projection.x - track.x1, projection.y - track.y1),
        distanceToTo: Math.hypot(projection.x - track.x2, projection.y - track.y2),
      };
      bestDistance = distance;
    }
  });

  return bestAttachment;
}

function findNativeTrackRoute(lineClass, fromPointKeys, toPointKeys) {
  if (!lineClass || !fromPointKeys?.length || !toPointKeys?.length) {
    return [];
  }

  const path = findNativeTrackPath(lineClass, fromPointKeys, toPointKeys);
  return [...new Set(path?.trackIds || [])];
}

function findNativeTrackPath(lineClass, fromPointKeys, toPointKeys) {
  if (!lineClass || !fromPointKeys || !toPointKeys) {
    return null;
  }

  const lineAdjacency = state.nativeDiagramTracks.adjacencyByClass.get(lineClass);
  if (!lineAdjacency) {
    return null;
  }

  const sourceKeys = [...new Set(fromPointKeys)].filter((pointKey) => lineAdjacency.has(pointKey));
  const targetKeySet = new Set(
    [...new Set(toPointKeys)].filter((pointKey) => lineAdjacency.has(pointKey)),
  );

  if (!sourceKeys.length || !targetKeySet.size) {
    return null;
  }

  if (sourceKeys.some((pointKey) => targetKeySet.has(pointKey))) {
    return { trackIds: [], totalWeight: 0 };
  }

  const queue = sourceKeys.map((pointKey) => ({ pointKey, score: 0 }));
  const distances = new Map(sourceKeys.map((pointKey) => [pointKey, 0]));
  const parents = new Map();
  let reachedTargetKey = null;

  while (queue.length) {
    queue.sort((left, right) => left.score - right.score);
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (targetKeySet.has(current.pointKey)) {
      reachedTargetKey = current.pointKey;
      break;
    }
    if (current.score !== distances.get(current.pointKey)) {
      continue;
    }

    const neighbors = lineAdjacency.get(current.pointKey) || [];
    neighbors.forEach((edge) => {
      const nextScore = current.score + edge.weight;
      if (nextScore >= (distances.get(edge.toKey) ?? Number.POSITIVE_INFINITY)) {
        return;
      }
      distances.set(edge.toKey, nextScore);
      parents.set(edge.toKey, { previous: current.pointKey, trackId: edge.trackId });
      queue.push({ pointKey: edge.toKey, score: nextScore });
    });
  }

  if (!reachedTargetKey) {
    return null;
  }

  const trackIds = [];
  let cursor = reachedTargetKey;

  while (!sourceKeys.includes(cursor)) {
    const parent = parents.get(cursor);
    if (!parent) {
      return null;
    }
    trackIds.push(parent.trackId);
    cursor = parent.previous;
  }

  trackIds.reverse();
  return {
    trackIds,
    totalWeight: distances.get(reachedTargetKey) ?? 0,
  };
}

function getApproximateDiagramPoint(station) {
  if (station.diagram_x !== null && station.diagram_x !== undefined
    && station.diagram_y !== null && station.diagram_y !== undefined) {
    return {
      x: roundToOneDecimal(station.diagram_x),
      y: roundToOneDecimal(station.diagram_y),
    };
  }

  return {
    x: roundToOneDecimal((station.x / state.network.map.width) * state.network.diagram.width),
    y: roundToOneDecimal((station.y / state.network.map.height) * state.network.diagram.height),
  };
}

function updatePointLineHints() {
  if (!state.network?.map?.supports_line_hints) {
    state.pointLineHints.start = [];
    state.pointLineHints.end = [];
    return;
  }
  state.pointLineHints.start = state.startPoint ? detectPreferredLineIds(state.startPoint) : [];
  state.pointLineHints.end = state.endPoint ? detectPreferredLineIds(state.endPoint) : [];
}

function detectPreferredLineIds(point) {
  const raster = state.realMapRaster;
  if (!raster?.ctx || !point || !state.lineColorEntries.length) {
    return [];
  }

  const radius = 70;
  const step = 4;
  const maxColorDistance = 60;
  const prominenceRatio = 0.72;
  const minScore = 1.4;
  const scores = new Map();

  for (let deltaY = -radius; deltaY <= radius; deltaY += step) {
    const sampleY = Math.round(point.y + deltaY);
    if (sampleY < 0 || sampleY >= state.network.map.height) {
      continue;
    }
    for (let deltaX = -radius; deltaX <= radius; deltaX += step) {
      const sampleX = Math.round(point.x + deltaX);
      if (sampleX < 0 || sampleX >= state.network.map.width) {
        continue;
      }
      const pixel = raster.ctx.getImageData(sampleX, sampleY, 1, 1).data;
      const pixelRgb = { r: pixel[0], g: pixel[1], b: pixel[2] };
      if (colorSaturation(pixelRgb) < 0.18) {
        continue;
      }

      let bestMatch = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      state.lineColorEntries.forEach((line) => {
        const distance = colorDistance(pixelRgb, line.rgb);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestMatch = line;
        }
      });

      if (!bestMatch || bestDistance > maxColorDistance) {
        continue;
      }

      const pointDistanceWeight = 1 / (1 + (Math.hypot(deltaX, deltaY) / 18));
      const colorWeight = 1 - (bestDistance / maxColorDistance);
      const score = pointDistanceWeight * colorWeight * colorWeight;
      scores.set(bestMatch.id, (scores.get(bestMatch.id) || 0) + score);
    }
  }

  const ranked = [...scores.entries()]
    .sort((left, right) => right[1] - left[1]);

  if (!ranked.length) {
    return [];
  }

  const topScore = ranked[0][1];
  return ranked
    .filter(([, score]) => score >= minScore && score >= (topScore * prominenceRatio))
    .slice(0, 3)
    .map(([lineId]) => lineId);
}

function buildRealMapRaster() {
  const canvas = document.createElement("canvas");
  canvas.width = state.network.map.width;
  canvas.height = state.network.map.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    state.realMapRaster = null;
    return;
  }
  ctx.drawImage(elements.realMapImage, 0, 0, canvas.width, canvas.height);
  state.realMapRaster = { canvas, ctx };
}

function ensureImageLoaded(image) {
  if (image.complete && image.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleLoad = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      resolve();
    };
    const handleError = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      reject(new Error("Failed to load the real map image."));
    };
    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
  });
}

function getIncidentLineClassesForPoint(nativeTracks, point) {
  const incidentLineClasses = new Set();

  nativeTracks.trackIdsByClass.forEach((trackIds, lineClass) => {
    let closestDistance = Number.POSITIVE_INFINITY;
    trackIds.forEach((trackId) => {
      const track = nativeTracks.byId.get(trackId);
      if (!track) {
        return;
      }
      const projection = projectPointOntoSegment(point, track);
      const distance = Math.hypot(projection.x - point.x, projection.y - point.y);
      if (distance < closestDistance) {
        closestDistance = distance;
      }
    });
    if (closestDistance <= 1.2) {
      incidentLineClasses.add(lineClass);
    }
  });

  return incidentLineClasses;
}

function projectPointOntoSegment(point, track) {
  const deltaX = track.x2 - track.x1;
  const deltaY = track.y2 - track.y1;
  const segmentLengthSquared = (deltaX ** 2) + (deltaY ** 2);
  if (!segmentLengthSquared) {
    return { x: track.x1, y: track.y1, ratio: 0 };
  }

  const ratio = clamp(
    (((point.x - track.x1) * deltaX) + ((point.y - track.y1) * deltaY)) / segmentLengthSquared,
    0,
    1,
  );

  return {
    x: roundToOneDecimal(track.x1 + (ratio * deltaX)),
    y: roundToOneDecimal(track.y1 + (ratio * deltaY)),
    ratio,
  };
}

function projectToDiagram(station) {
  const nativeStation = getNativeDiagramStation(station);
  if (nativeStation) {
    return {
      x: roundToOneDecimal(nativeStation.x),
      y: roundToOneDecimal(nativeStation.y),
    };
  }

  if (station.diagram_x !== null && station.diagram_x !== undefined
    && station.diagram_y !== null && station.diagram_y !== undefined) {
    return {
      x: roundToOneDecimal(station.diagram_x),
      y: roundToOneDecimal(station.diagram_y),
    };
  }

  return {
    x: getApproximateDiagramPoint(station).x,
    y: getApproximateDiagramPoint(station).y,
  };
}

function eventToMapPoint(event, surface, controller, width, height) {
  const rect = surface.getBoundingClientRect();
  const surfaceX = event.clientX - rect.left;
  const surfaceY = event.clientY - rect.top;
  const scale = controller?.scale || 1;
  const translateX = controller?.translateX || 0;
  const translateY = controller?.translateY || 0;
  const contentX = (surfaceX - translateX) / scale;
  const contentY = (surfaceY - translateY) / scale;
  return {
    x: roundToOneDecimal(clamp((contentX / rect.width) * width, 0, width)),
    y: roundToOneDecimal(clamp((contentY / rect.height) * height, 0, height)),
  };
}

function segmentDomId(lineId, stationIdA, stationIdB) {
  const pair = [stationIdA, stationIdB].sort().join("--");
  return `segment-${lineId}-${pair}`;
}

function stationDomId(stationId) {
  return `station-${stationId}`;
}

function formatDuration(totalSec) {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

function formatPoint(point) {
  return `${Math.round(point.x)}, ${Math.round(point.y)}`;
}

function formatLineHints(lineIds) {
  return lineIds
    .map((lineId) => state.lineLookup.get(lineId)?.name || lineId)
    .join(" / ");
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function roundToThreeDecimals(value) {
  return Math.round(value * 1000) / 1000;
}

function pointKey(x, y) {
  return `${roundToOneDecimal(x)},${roundToOneDecimal(y)}`;
}

function compareTuple(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }
  return 0;
}

function parseColor(value) {
  if (!value) {
    return null;
  }

  const raw = String(value).trim().toLowerCase();
  if (raw.startsWith("#")) {
    const expanded = raw.length === 4
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
    return {
      r: Number.parseInt(expanded.slice(1, 3), 16),
      g: Number.parseInt(expanded.slice(3, 5), 16),
      b: Number.parseInt(expanded.slice(5, 7), 16),
    };
  }

  const rgbMatch = raw.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!rgbMatch) {
    return null;
  }

  return {
    r: Number(rgbMatch[1]),
    g: Number(rgbMatch[2]),
    b: Number(rgbMatch[3]),
  };
}

function colorDistance(left, right) {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

function colorSaturation(color) {
  const max = Math.max(color.r, color.g, color.b) / 255;
  const min = Math.min(color.r, color.g, color.b) / 255;
  if (max === 0) {
    return 0;
  }
  return (max - min) / max;
}

function normalizeStationKey(value) {
  return String(value)
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/\bstation\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function initZoomControllers() {
  state.zoomControllers = {
    real: createZoomController("real", elements.realMapSurface, elements.realMapStage),
    diagram: createZoomController("diagram", elements.diagramSurface, elements.diagramStage),
  };
}

function createZoomController(name, surface, stage) {
  const controller = {
    name,
    surface,
    stage,
    scale: 1,
    maxScale: ZOOM.maxScale,
    translateX: 0,
    translateY: 0,
    pointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    moved: false,
    allowsPan: false,
    zoomAnimationTimer: null,
  };

  surface.addEventListener("wheel", (event) => handleZoomWheel(event, controller), {
    passive: false,
  });
  surface.addEventListener("pointerdown", (event) => startPan(event, controller));
  surface.addEventListener("pointermove", (event) => updatePan(event, controller));
  surface.addEventListener("pointerup", (event) => endPan(event, controller));
  surface.addEventListener("pointerleave", (event) => endPan(event, controller));
  surface.addEventListener("pointercancel", (event) => endPan(event, controller));

  recalculateZoomBounds(controller);
  applyZoomTransform(controller);
  return controller;
}

function handleZoomWheel(event, controller) {
  event.preventDefault();

  const rect = controller.surface.getBoundingClientRect();
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
  const rawFactor = Math.exp(-event.deltaY * deltaMultiplier * ZOOM.wheelSensitivity);
  const direction = clamp(rawFactor, ZOOM.minWheelFactor, ZOOM.maxWheelFactor);

  zoomAroundPoint(controller, direction, cursorX, cursorY);
}

function startPan(event, controller) {
  if (event.button !== 0) {
    return;
  }

  controller.pointerId = event.pointerId;
  controller.dragStartX = event.clientX;
  controller.dragStartY = event.clientY;
  controller.dragOriginX = controller.translateX;
  controller.dragOriginY = controller.translateY;
  controller.moved = false;
  controller.allowsPan = controller.scale > 1;
  if (controller.allowsPan) {
    stopZoomAnimation(controller);
  }
  controller.surface.setPointerCapture(event.pointerId);
}

function updatePan(event, controller) {
  if (controller.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - controller.dragStartX;
  const deltaY = event.clientY - controller.dragStartY;

  if (!controller.moved && Math.hypot(deltaX, deltaY) >= ZOOM.dragThreshold) {
    controller.moved = true;
    if (controller.allowsPan) {
      controller.surface.classList.add("is-dragging");
    }
  }

  if (!controller.allowsPan) {
    return;
  }

  controller.translateX = controller.dragOriginX + deltaX;
  controller.translateY = controller.dragOriginY + deltaY;
  clampPan(controller);
  applyZoomTransform(controller);
}

function endPan(event, controller) {
  if (controller.pointerId !== event.pointerId) {
    return;
  }

  const shouldSelectRealPoint =
    event.type === "pointerup" && controller.name === "real" && !controller.moved;

  controller.surface.classList.remove("is-dragging");
  if (controller.surface.hasPointerCapture(event.pointerId)) {
    controller.surface.releasePointerCapture(event.pointerId);
  }
  controller.pointerId = null;
  controller.allowsPan = false;
  controller.moved = false;

  if (shouldSelectRealPoint) {
    selectRealMapPointFromEvent(event);
  }
}

function runZoomAction(target, action) {
  const controller = state.zoomControllers[target];
  if (!controller) {
    return;
  }

  if (action === "reset") {
    resetZoom(controller);
    return;
  }

  const rect = controller.surface.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const factor = action === "zoom-in" ? ZOOM.step : 1 / ZOOM.step;
  zoomAroundPoint(controller, factor, centerX, centerY);
}

function zoomAroundPoint(controller, factor, anchorX, anchorY) {
  const nextScale = clamp(controller.scale * factor, ZOOM.minScale, controller.maxScale);
  if (nextScale === controller.scale) {
    return;
  }

  const contentX = (anchorX - controller.translateX) / controller.scale;
  const contentY = (anchorY - controller.translateY) / controller.scale;

  controller.scale = nextScale;
  controller.translateX = anchorX - contentX * controller.scale;
  controller.translateY = anchorY - contentY * controller.scale;

  clampPan(controller);
  triggerZoomAnimation(controller);
  applyZoomTransform(controller);
}

function resetZoom(controller) {
  stopZoomAnimation(controller);
  controller.scale = 1;
  controller.translateX = 0;
  controller.translateY = 0;
  controller.pointerId = null;
  controller.allowsPan = false;
  controller.moved = false;
  controller.surface.classList.remove("is-dragging");
  applyZoomTransform(controller);
}

function resetAllZoom() {
  Object.values(state.zoomControllers).forEach((controller) => {
    resetZoom(controller);
  });
}

function handleWindowResize() {
  Object.values(state.zoomControllers).forEach((controller) => {
    recalculateZoomBounds(controller);
    clampPan(controller);
    applyZoomTransform(controller);
  });
}

function recalculateZoomBounds(controller) {
  const rect = controller.surface.getBoundingClientRect();
  if (!rect.width || !rect.height || !state.network) {
    controller.maxScale = ZOOM.maxScale;
    return;
  }

  const source =
    controller.name === "real" ? state.network.map : state.network.diagram;

  if (source.is_vector) {
    controller.maxScale = Math.max(ZOOM.maxScale, source.max_zoom || ZOOM.maxScale);
    controller.scale = clamp(controller.scale, ZOOM.minScale, controller.maxScale);
    return;
  }

  const limitByWidth = source.raster_width / rect.width;
  const limitByHeight = source.raster_height / rect.height;
  controller.maxScale = clamp(
    Math.min(limitByWidth, limitByHeight, source.max_zoom || ZOOM.maxScale),
    ZOOM.minScale,
    source.max_zoom || ZOOM.maxScale,
  );
  controller.scale = clamp(controller.scale, ZOOM.minScale, controller.maxScale);
}

function clampPan(controller) {
  if (controller.scale <= 1) {
    controller.translateX = 0;
    controller.translateY = 0;
    return;
  }

  const rect = controller.surface.getBoundingClientRect();
  const minX = rect.width - rect.width * controller.scale;
  const minY = rect.height - rect.height * controller.scale;

  controller.translateX = clamp(controller.translateX, minX, 0);
  controller.translateY = clamp(controller.translateY, minY, 0);
}

function applyZoomTransform(controller) {
  controller.stage.style.transform = `translate3d(${controller.translateX}px, ${controller.translateY}px, 0) scale(${controller.scale})`;
  controller.surface.classList.toggle("is-zoomed", controller.scale > 1);
  if (controller.name === "real") {
    controller.surface.classList.toggle(
      "is-label-zoom",
      controller.scale >= ZOOM.realMapLabelScaleThreshold,
    );
  }
}

function triggerZoomAnimation(controller) {
  controller.stage.classList.add("is-zoom-animating");
  if (controller.zoomAnimationTimer) {
    window.clearTimeout(controller.zoomAnimationTimer);
  }
  controller.zoomAnimationTimer = window.setTimeout(() => {
    controller.stage.classList.remove("is-zoom-animating");
    controller.zoomAnimationTimer = null;
  }, ZOOM.animationMs);
}

function stopZoomAnimation(controller) {
  if (controller.zoomAnimationTimer) {
    window.clearTimeout(controller.zoomAnimationTimer);
    controller.zoomAnimationTimer = null;
  }
  controller.stage.classList.remove("is-zoom-animating");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

init();

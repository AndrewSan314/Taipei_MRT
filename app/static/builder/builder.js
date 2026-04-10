const builderState = {
  network: null,
  stations: new Map(),
  lines: new Map(),
  lineOrders: new Map(),
  activeStationId: null,
  activeLineId: null,
  activeLineOrderIndex: null,
  zoomController: null,
  nativeStationLookup: new Map(),
  diagramSvgUrl: null,
};

const builderElements = {
  statusText: document.getElementById("builderStatusText"),
  saveBtn: document.getElementById("saveNetworkBtn"),
  reloadBtn: document.getElementById("reloadBuilderBtn"),
  startBlankBtn: document.getElementById("startBlankBtn"),
  addLineBtn: document.getElementById("addLineBtn"),
  addStationBtn: document.getElementById("addStationBtn"),
  deleteStationBtn: document.getElementById("deleteStationBtn"),
  appendStationBtn: document.getElementById("appendStationBtn"),
  removeLineStationBtn: document.getElementById("removeLineStationBtn"),
  moveLineStationUpBtn: document.getElementById("moveLineStationUpBtn"),
  moveLineStationDownBtn: document.getElementById("moveLineStationDownBtn"),
  lineIdInput: document.getElementById("lineIdInput"),
  lineNameInput: document.getElementById("lineNameInput"),
  lineColorInput: document.getElementById("lineColorInput"),
  stationIdInput: document.getElementById("stationIdInput"),
  stationNameInput: document.getElementById("stationNameInput"),
  lineList: document.getElementById("lineList"),
  stationList: document.getElementById("stationList"),
  lineOrderList: document.getElementById("lineOrderList"),
  activeStationCard: document.getElementById("activeStationCard"),
  activeLineCard: document.getElementById("activeLineCard"),
  diagramSurface: document.getElementById("builderDiagramSurface"),
  diagramStage: document.getElementById("builderDiagramStage"),
  diagramDocument: document.getElementById("builderDiagramDocument"),
  diagramOverlay: document.getElementById("builderDiagramOverlay"),
  zoomOutBtn: document.getElementById("builderZoomOutBtn"),
  zoomInBtn: document.getElementById("builderZoomInBtn"),
  zoomResetBtn: document.getElementById("builderZoomResetBtn"),
};

async function initBuilder() {
  bindBuilderEvents();
  await reloadBuilderData();
}

function bindBuilderEvents() {
  builderElements.reloadBtn.addEventListener("click", reloadBuilderData);
  builderElements.startBlankBtn.addEventListener("click", startBlankNetwork);
  builderElements.saveBtn.addEventListener("click", saveBuilderNetwork);
  builderElements.addLineBtn.addEventListener("click", addLine);
  builderElements.addStationBtn.addEventListener("click", addStation);
  builderElements.deleteStationBtn.addEventListener("click", deleteActiveStation);
  builderElements.appendStationBtn.addEventListener("click", appendActiveStationToLine);
  builderElements.removeLineStationBtn.addEventListener("click", removeSelectedLineStation);
  builderElements.moveLineStationUpBtn.addEventListener("click", () => moveSelectedLineStation(-1));
  builderElements.moveLineStationDownBtn.addEventListener("click", () => moveSelectedLineStation(1));
  builderElements.zoomOutBtn.addEventListener("click", () => runBuilderZoom("zoom-out"));
  builderElements.zoomInBtn.addEventListener("click", () => runBuilderZoom("zoom-in"));
  builderElements.zoomResetBtn.addEventListener("click", () => runBuilderZoom("reset"));
  builderElements.diagramOverlay.addEventListener("click", placeActiveStationOnDiagram);
  window.addEventListener("resize", syncBuilderZoomBounds);
}

async function reloadBuilderData() {
  setBuilderStatus("Loading builder data...");
  const response = await fetch("/api/builder/network");
  const payload = await response.json();

  builderState.network = payload;
  await ensureBuilderDiagram(payload.diagram.svg_url);
  builderState.stations = new Map(
    payload.stations.map((station) => [
      station.id,
      resolveBuilderStation(station, payload.diagram),
    ]),
  );
  builderState.lines = new Map(
    payload.lines.map((line) => [
      line.id,
      {
        id: line.id,
        name: line.name,
        color: line.color,
      },
    ]),
  );
  builderState.lineOrders = buildLineOrders(payload.station_lines);

  if (!builderState.activeLineId || !builderState.lines.has(builderState.activeLineId)) {
    builderState.activeLineId = payload.lines[0]?.id ?? null;
  }
  if (!builderState.activeStationId || !builderState.stations.has(builderState.activeStationId)) {
    builderState.activeStationId = payload.stations[0]?.id ?? null;
  }
  builderState.activeLineOrderIndex = null;

  builderElements.diagramSurface.style.aspectRatio = `${payload.diagram.width} / ${payload.diagram.height}`;
  builderElements.diagramOverlay.setAttribute(
    "viewBox",
    `0 0 ${payload.diagram.width} ${payload.diagram.height}`,
  );
  initBuilderZoom(payload.diagram);

  renderBuilder();
  setBuilderStatus("Builder ready. Create lines, place stations, then save.");
}

async function ensureBuilderDiagram(svgUrl) {
  if (builderState.diagramSvgUrl === svgUrl && builderState.nativeStationLookup.size > 0) {
    return;
  }

  const response = await fetch(svgUrl);
  const markup = await response.text();
  builderElements.diagramDocument.innerHTML = markup;

  const svgRoot = builderElements.diagramDocument.querySelector("svg");
  if (!svgRoot) {
    builderState.nativeStationLookup = new Map();
    builderState.diagramSvgUrl = svgUrl;
    return;
  }

  svgRoot.classList.add("builder-native-diagram");
  svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
  builderState.nativeStationLookup = buildNativeStationLookup(svgRoot);
  builderState.diagramSvgUrl = svgUrl;
}

function buildNativeStationLookup(svgRoot) {
  const lookup = new Map();

  svgRoot.querySelectorAll(".station-node").forEach((node) => {
    const marker = node.querySelector(".station-marker");
    const name = node.getAttribute("data-station-name") || node.id || "";
    const key = normalizeStationKey(name);
    if (!marker || !key || lookup.has(key)) {
      return;
    }

    lookup.set(key, {
      node,
      name,
      x: Number(marker.getAttribute("x") || 0),
      y: Number(marker.getAttribute("y") || 0),
    });
  });

  return lookup;
}

function resolveBuilderStation(rawStation, diagram) {
  const position = resolveBuilderStationPosition(rawStation, diagram);

  return {
    id: rawStation.id,
    name: rawStation.name,
    x: position.x,
    y: position.y,
  };
}

function resolveBuilderStationPosition(rawStation, diagram) {
  if (rawStation.diagram_x !== null && rawStation.diagram_x !== undefined
    && rawStation.diagram_y !== null && rawStation.diagram_y !== undefined) {
    return {
      x: Number(rawStation.diagram_x),
      y: Number(rawStation.diagram_y),
    };
  }

  if (isDiagramCoordinate(rawStation.x, rawStation.y, diagram)) {
    return {
      x: Number(rawStation.x),
      y: Number(rawStation.y),
    };
  }

  const nativeStation = getNativeStationMatch(rawStation.name);
  if (nativeStation) {
    return {
      x: nativeStation.x,
      y: nativeStation.y,
    };
  }

  return {
    x: Math.round(diagram.width / 2),
    y: Math.round(diagram.height / 2),
  };
}

function isDiagramCoordinate(x, y, diagram) {
  return Number.isFinite(Number(x))
    && Number.isFinite(Number(y))
    && Number(x) >= 0
    && Number(y) >= 0
    && Number(x) <= diagram.width
    && Number(y) <= diagram.height;
}

function getNativeStationMatch(stationName) {
  return builderState.nativeStationLookup.get(normalizeStationKey(stationName)) ?? null;
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

function startBlankNetwork() {
  builderState.stations = new Map();
  builderState.lines = new Map();
  builderState.lineOrders = new Map();
  builderState.activeStationId = null;
  builderState.activeLineId = null;
  builderState.activeLineOrderIndex = null;
  renderBuilder();
  setBuilderStatus("Blank graph loaded. Add lines and stations to rebuild from scratch.");
}

function buildLineOrders(stationLines) {
  const grouped = new Map();

  stationLines
    .slice()
    .sort((left, right) => {
      if (left.line_id !== right.line_id) {
        return left.line_id.localeCompare(right.line_id);
      }
      return left.seq - right.seq;
    })
    .forEach((stationLine) => {
      if (!grouped.has(stationLine.line_id)) {
        grouped.set(stationLine.line_id, []);
      }
      grouped.get(stationLine.line_id).push(stationLine.station_id);
    });

  return grouped;
}

function renderBuilder() {
  renderLineList();
  renderStationList();
  renderActiveCards();
  renderLineOrderList();
  renderDiagram();
}

function renderLineList() {
  const rows = Array.from(builderState.lines.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((line) => {
      const isActive = line.id === builderState.activeLineId;
      const memberCount = builderState.lineOrders.get(line.id)?.length ?? 0;
      return `
        <button class="builder-row ${isActive ? "active" : ""}" data-line-id="${line.id}">
          <strong>${escapeHtml(line.name)}</strong>
          <small>${escapeHtml(line.id)} · ${memberCount} stations · ${escapeHtml(line.color)}</small>
        </button>
      `;
    })
    .join("");

  builderElements.lineList.innerHTML = rows || '<div class="empty">No lines yet.</div>';
  builderElements.lineList.querySelectorAll("[data-line-id]").forEach((button) => {
    button.addEventListener("click", () => {
      builderState.activeLineId = button.dataset.lineId;
      builderState.activeLineOrderIndex = null;
      renderBuilder();
    });
  });
}

function renderStationList() {
  const rows = Array.from(builderState.stations.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((station) => {
      const isActive = station.id === builderState.activeStationId;
      return `
        <button class="builder-row ${isActive ? "active" : ""}" data-station-id="${station.id}">
          <strong>${escapeHtml(station.name)}</strong>
          <small>${escapeHtml(station.id)} · (${Math.round(station.x)}, ${Math.round(station.y)})</small>
        </button>
      `;
    })
    .join("");

  builderElements.stationList.innerHTML = rows || '<div class="empty">No stations yet.</div>';
  builderElements.stationList.querySelectorAll("[data-station-id]").forEach((button) => {
    button.addEventListener("click", () => {
      builderState.activeStationId = button.dataset.stationId;
      renderBuilder();
    });
  });
}

function renderActiveCards() {
  const station = builderState.stations.get(builderState.activeStationId);
  if (!station) {
    builderElements.activeStationCard.classList.add("empty");
    builderElements.activeStationCard.textContent = "No active station.";
  } else {
    builderElements.activeStationCard.classList.remove("empty");
    builderElements.activeStationCard.innerHTML = `
      <div class="active-station-title"><strong>${escapeHtml(station.name)}</strong></div>
      <div>ID: ${escapeHtml(station.id)}</div>
      <div>diagram_x: ${Math.round(station.x)}</div>
      <div>diagram_y: ${Math.round(station.y)}</div>
    `;
  }

  const line = builderState.lines.get(builderState.activeLineId);
  if (!line) {
    builderElements.activeLineCard.classList.add("empty");
    builderElements.activeLineCard.textContent = "No active line.";
    return;
  }

  const count = builderState.lineOrders.get(line.id)?.length ?? 0;
  builderElements.activeLineCard.classList.remove("empty");
  builderElements.activeLineCard.innerHTML = `
    <div class="active-station-title"><strong>${escapeHtml(line.name)}</strong></div>
    <div>ID: ${escapeHtml(line.id)}</div>
    <div>Color: ${escapeHtml(line.color)}</div>
    <div>Ordered stations: ${count}</div>
  `;
}

function renderLineOrderList() {
  const lineId = builderState.activeLineId;
  const stationIds = lineId ? builderState.lineOrders.get(lineId) ?? [] : [];

  builderElements.lineOrderList.innerHTML = stationIds.length
    ? stationIds
        .map((stationId, index) => {
          const station = builderState.stations.get(stationId);
          const active = index === builderState.activeLineOrderIndex ? "active" : "";
          return `
            <button class="builder-row ${active}" data-order-index="${index}">
              <strong>${index + 1}. ${escapeHtml(station?.name || stationId)}</strong>
              <small>${escapeHtml(stationId)}</small>
            </button>
          `;
        })
        .join("")
    : '<div class="empty">No ordered stations on this line.</div>';

  builderElements.lineOrderList.querySelectorAll("[data-order-index]").forEach((button) => {
    button.addEventListener("click", () => {
      builderState.activeLineOrderIndex = Number(button.dataset.orderIndex);
      renderLineOrderList();
    });
  });
}

function renderDiagram() {
  const lineMarkup = Array.from(builderState.lines.values())
    .map((line) => renderLinePath(line))
    .join("");

  const stationMarkup = Array.from(builderState.stations.values())
    .filter((station) => !getNativeStationMatch(station.name))
    .map((station) => renderStationMarker(station))
    .join("");

  const activeStation = builderState.stations.get(builderState.activeStationId);

  builderElements.diagramOverlay.innerHTML = `
    <g class="builder-lines">${lineMarkup}</g>
    <g class="builder-stations">${stationMarkup}</g>
    ${activeStation ? renderBuilderCrosshair(activeStation) : ""}
  `;
  updateNativeStationVisuals();
}

function renderLinePath(line) {
  const stationIds = builderState.lineOrders.get(line.id) ?? [];
  if (stationIds.length < 2) {
    return "";
  }

  const points = stationIds
    .map((stationId) => builderState.stations.get(stationId))
    .filter(Boolean)
    .map((station) => `${station.x},${station.y}`)
    .join(" ");

  return `
    <polyline
      class="builder-line-path ${line.id === builderState.activeLineId ? "is-active-line" : ""}"
      points="${points}"
      stroke="${escapeHtml(line.color)}"
    ></polyline>
  `;
}

function renderStationMarker(station) {
  const isActive = station.id === builderState.activeStationId;
  const onActiveLine = (builderState.lineOrders.get(builderState.activeLineId) ?? []).includes(station.id);

  return `
    <g>
      <circle class="builder-station-halo" cx="${station.x}" cy="${station.y}" r="2.6"></circle>
      <circle
        class="builder-station-core ${isActive ? "is-active" : ""} ${onActiveLine ? "is-on-active-line" : ""}"
        cx="${station.x}"
        cy="${station.y}"
        r="1.4"
      ></circle>
      <text class="builder-station-label" x="${station.x + 2.4}" y="${station.y - 2.8}">
        ${escapeHtml(station.name)}
      </text>
    </g>
  `;
}

function renderBuilderCrosshair(station) {
  return `
    <g>
      <line class="builder-crosshair" x1="${station.x - 3.8}" y1="${station.y}" x2="${station.x + 3.8}" y2="${station.y}"></line>
      <line class="builder-crosshair" x1="${station.x}" y1="${station.y - 3.8}" x2="${station.x}" y2="${station.y + 3.8}"></line>
    </g>
  `;
}

function updateNativeStationVisuals() {
  const svgRoot = builderElements.diagramDocument.querySelector("svg");
  if (!svgRoot) {
    return;
  }

  svgRoot.querySelectorAll(".station-node").forEach((node) => {
    node.classList.remove("is-builder-known", "is-builder-on-line", "is-builder-active");
    node.removeAttribute("data-builder-station-id");
  });

  const activeLineStationIds = new Set(builderState.lineOrders.get(builderState.activeLineId) ?? []);
  builderState.stations.forEach((station) => {
    const nativeStation = getNativeStationMatch(station.name);
    if (!nativeStation) {
      return;
    }

    nativeStation.node.classList.add("is-builder-known");
    if (activeLineStationIds.has(station.id)) {
      nativeStation.node.classList.add("is-builder-on-line");
    }
    if (station.id === builderState.activeStationId) {
      nativeStation.node.classList.add("is-builder-active");
    }
    nativeStation.node.setAttribute("data-builder-station-id", station.id);
  });
}

function addLine() {
  const id = builderElements.lineIdInput.value.trim();
  const name = builderElements.lineNameInput.value.trim();
  const color = builderElements.lineColorInput.value.trim();

  if (!id || !name || !color) {
    setBuilderStatus("Line ID, name, and color are required.");
    return;
  }
  if (builderState.lines.has(id)) {
    setBuilderStatus(`Line ${id} already exists.`);
    return;
  }

  builderState.lines.set(id, { id, name, color });
  builderState.lineOrders.set(id, []);
  builderState.activeLineId = id;
  builderState.activeLineOrderIndex = null;
  builderElements.lineIdInput.value = "";
  builderElements.lineNameInput.value = "";
  renderBuilder();
  setBuilderStatus(`Line ${id} created.`);
}

function addStation() {
  const id = builderElements.stationIdInput.value.trim();
  const name = builderElements.stationNameInput.value.trim();

  if (!id || !name) {
    setBuilderStatus("Station ID and name are required.");
    return;
  }
  if (builderState.stations.has(id)) {
    setBuilderStatus(`Station ${id} already exists.`);
    return;
  }

  const nativeStation = getNativeStationMatch(name);
  const centerX = Math.round(builderState.network.diagram.width / 2);
  const centerY = Math.round(builderState.network.diagram.height / 2);
  builderState.stations.set(id, {
    id,
    name,
    x: nativeStation?.x ?? centerX,
    y: nativeStation?.y ?? centerY,
  });
  builderState.activeStationId = id;
  builderElements.stationIdInput.value = "";
  builderElements.stationNameInput.value = "";
  renderBuilder();
  if (nativeStation) {
    setBuilderStatus(`Station ${id} snapped to native SVG node ${nativeStation.name}.`);
    return;
  }

  setBuilderStatus(`Station ${id} created at center. Click the diagram to place it.`);
}

function deleteActiveStation() {
  if (!builderState.activeStationId) {
    setBuilderStatus("No active station to delete.");
    return;
  }

  const stationId = builderState.activeStationId;
  builderState.stations.delete(stationId);
  builderState.lineOrders.forEach((stationIds, lineId) => {
    builderState.lineOrders.set(
      lineId,
      stationIds.filter((currentStationId) => currentStationId !== stationId),
    );
  });

  builderState.activeStationId = Array.from(builderState.stations.keys())[0] ?? null;
  builderState.activeLineOrderIndex = null;
  renderBuilder();
  setBuilderStatus(`Station ${stationId} deleted.`);
}

function appendActiveStationToLine() {
  const lineId = builderState.activeLineId;
  const stationId = builderState.activeStationId;

  if (!lineId || !stationId) {
    setBuilderStatus("You need both an active line and an active station.");
    return;
  }

  const stationIds = builderState.lineOrders.get(lineId) ?? [];
  if (stationIds.includes(stationId)) {
    setBuilderStatus(`Station ${stationId} is already on line ${lineId}.`);
    return;
  }

  stationIds.push(stationId);
  builderState.lineOrders.set(lineId, stationIds);
  builderState.activeLineOrderIndex = stationIds.length - 1;
  renderBuilder();
  setBuilderStatus(`Station ${stationId} appended to line ${lineId}.`);
}

function removeSelectedLineStation() {
  const lineId = builderState.activeLineId;
  if (!lineId) {
    setBuilderStatus("No active line.");
    return;
  }
  if (builderState.activeLineOrderIndex === null) {
    setBuilderStatus("No selected line-order row.");
    return;
  }

  const stationIds = [...(builderState.lineOrders.get(lineId) ?? [])];
  stationIds.splice(builderState.activeLineOrderIndex, 1);
  builderState.lineOrders.set(lineId, stationIds);
  builderState.activeLineOrderIndex = null;
  renderBuilder();
  setBuilderStatus(`Removed selected station from line ${lineId}.`);
}

function moveSelectedLineStation(direction) {
  const lineId = builderState.activeLineId;
  const currentIndex = builderState.activeLineOrderIndex;
  if (!lineId || currentIndex === null) {
    setBuilderStatus("No selected line-order row.");
    return;
  }

  const stationIds = [...(builderState.lineOrders.get(lineId) ?? [])];
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= stationIds.length) {
    return;
  }

  [stationIds[currentIndex], stationIds[nextIndex]] = [stationIds[nextIndex], stationIds[currentIndex]];
  builderState.lineOrders.set(lineId, stationIds);
  builderState.activeLineOrderIndex = nextIndex;
  renderBuilder();
}

function initBuilderZoom(diagram) {
  if (!window.BuilderZoom) {
    return;
  }

  if (!builderState.zoomController) {
    builderState.zoomController = window.BuilderZoom.createBuilderZoomController(
      builderElements.diagramSurface,
      builderElements.diagramStage,
      diagram,
    );
  } else {
    window.BuilderZoom.setBuilderZoomSource(builderState.zoomController, diagram);
  }

  syncBuilderZoomBounds();
  requestAnimationFrame(syncBuilderZoomBounds);
}

function runBuilderZoom(action) {
  if (!builderState.zoomController || !window.BuilderZoom) {
    return;
  }

  window.BuilderZoom.runBuilderZoomAction(builderState.zoomController, action);
}

function syncBuilderZoomBounds() {
  if (!builderState.zoomController || !window.BuilderZoom) {
    return;
  }

  window.BuilderZoom.syncBuilderZoomLayout(builderState.zoomController);
}

function placeActiveStationOnDiagram(event) {
  if (builderState.zoomController?.suppressClick) {
    builderState.zoomController.suppressClick = false;
    return;
  }
  if (!builderState.activeStationId) {
    setBuilderStatus("Select or create a station first.");
    return;
  }

  const point = builderState.zoomController && window.BuilderZoom
    ? window.BuilderZoom.builderEventToDiagramPoint(event, builderState.zoomController)
    : null;
  if (!point) {
    return;
  }
  const station = builderState.stations.get(builderState.activeStationId);
  station.x = Math.round(point.x);
  station.y = Math.round(point.y);
  renderBuilder();
  setBuilderStatus(`Placed station ${station.id} on the diagram.`);
}

async function saveBuilderNetwork() {
  const payload = {
    stations: Array.from(builderState.stations.values()).map((station) => ({
      id: station.id,
      name: station.name,
      x: station.x,
      y: station.y,
    })),
    lines: Array.from(builderState.lines.values()),
    station_lines: buildStationLinePayload(),
    default_travel_sec: 90,
    default_transfer_sec: 180,
  };

  if (!payload.lines.length) {
    setBuilderStatus("At least one line is required.");
    return;
  }
  if (!payload.stations.length) {
    setBuilderStatus("At least one station is required.");
    return;
  }

  setBuilderStatus("Saving network definition...");
  const response = await fetch("/api/builder/network", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();

  if (!response.ok) {
    setBuilderStatus(body.detail || "Failed to save network definition.");
    return;
  }

  setBuilderStatus(
    `Saved ${body.saved.stations} stations, ${body.saved.lines} lines, ${body.saved.segments} segments.`,
  );
}

function buildStationLinePayload() {
  const stationLines = [];

  builderState.lineOrders.forEach((stationIds, lineId) => {
    stationIds.forEach((stationId, index) => {
      stationLines.push({
        station_id: stationId,
        line_id: lineId,
        seq: index + 1,
      });
    });
  });

  return stationLines;
}

function setBuilderStatus(message) {
  builderElements.statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

initBuilder();

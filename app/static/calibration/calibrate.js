const calState = {
  network: null,
  activeStationId: null,
  stationMap: new Map(),
  overlay: createCalibrationOverlayState("/map/geography/taipei-metro-geographical-map.svg"),
};

const calElements = {
  map: document.getElementById("calibrationMap"),
  stationList: document.getElementById("stationList"),
  statusText: document.getElementById("statusText"),
  activeStationCard: document.getElementById("activeStationCard"),
  saveBtn: document.getElementById("saveBtn"),
  resetBtn: document.getElementById("resetBtn"),
  overlayEnabled: document.getElementById("overlayEnabled"),
  overlayOpacity: document.getElementById("overlayOpacity"),
  overlayOpacityValue: document.getElementById("overlayOpacityValue"),
  overlayScale: document.getElementById("overlayScale"),
  overlayOffsetX: document.getElementById("overlayOffsetX"),
  overlayOffsetY: document.getElementById("overlayOffsetY"),
  overlayFitBtn: document.getElementById("overlayFitBtn"),
  overlayResetBtn: document.getElementById("overlayResetBtn"),
};

async function initCalibration() {
  await loadCalibrationOverlayMetadata(calState.overlay);
  await reloadNetwork();
  bindCalibrationEvents();
  syncCalibrationOverlayControls(calState.overlay, calElements);
}

async function reloadNetwork() {
  setCalibrationStatus("Đang nạp network…");
  const response = await fetch("/api/network");
  calState.network = await response.json();
  calState.stationMap = new Map(
    calState.network.stations.map((station) => [station.id, { ...station }]),
  );
  calElements.map.setAttribute(
    "viewBox",
    `0 0 ${calState.network.map.width} ${calState.network.map.height}`,
  );

  if (!calState.activeStationId && calState.network.stations.length) {
    calState.activeStationId = calState.network.stations[0].id;
  }

  if (calState.overlay.ready && !calState.overlay.positioned) {
    fitOverlayToCurrentMap();
  }

  renderStationList();
  renderActiveStation();
  renderCalibrationMap();
  syncCalibrationOverlayControls(calState.overlay, calElements);
  setCalibrationStatus("Sẵn sàng. Chọn ga và click vào ảnh để đặt node.");
}

function bindCalibrationEvents() {
  calElements.saveBtn.addEventListener("click", saveCalibration);
  calElements.resetBtn.addEventListener("click", reloadNetwork);

  document.querySelectorAll(".nudge-grid button").forEach((button) => {
    button.addEventListener("click", () => {
      if (!calState.activeStationId) {
        return;
      }

      const station = calState.stationMap.get(calState.activeStationId);
      station.x += Number(button.dataset.dx);
      station.y += Number(button.dataset.dy);
      renderActiveStation();
      renderCalibrationMap();
      renderStationList();
    });
  });

  bindCalibrationOverlayControls({
    overlay: calState.overlay,
    elements: calElements,
    renderMap: renderCalibrationMap,
    fitOverlay: () => {
      fitOverlayToCurrentMap();
    },
    resetOverlay: () => {
      resetOverlayToCurrentMap();
    },
  });
}

function fitOverlayToCurrentMap() {
  if (!calState.network) {
    return;
  }

  fitCalibrationOverlayToMap(
    calState.overlay,
    calState.network.map.width,
    calState.network.map.height,
  );
}

function resetOverlayToCurrentMap() {
  if (!calState.network) {
    return;
  }

  resetCalibrationOverlay(
    calState.overlay,
    calState.network.map.width,
    calState.network.map.height,
  );
}

function renderStationList() {
  calElements.stationList.innerHTML = Array.from(calState.stationMap.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((station) => {
      const active = station.id === calState.activeStationId ? "active" : "";
      return `
        <button class="station-row ${active}" data-station-id="${station.id}">
          <strong>${station.name}</strong>
          <small>${station.id} · (${Math.round(station.x)}, ${Math.round(station.y)})</small>
        </button>
      `;
    })
    .join("");

  calElements.stationList.querySelectorAll(".station-row").forEach((button) => {
    button.addEventListener("click", () => {
      calState.activeStationId = button.dataset.stationId;
      renderActiveStation();
      renderCalibrationMap();
      renderStationList();
    });
  });
}

function renderActiveStation() {
  const station = calState.stationMap.get(calState.activeStationId);
  if (!station) {
    calElements.activeStationCard.textContent = "Chưa chọn ga nào.";
    return;
  }

  calElements.activeStationCard.classList.remove("empty");
  calElements.activeStationCard.innerHTML = `
    <div class="active-station-title">
      <strong>${station.name}</strong>
    </div>
    <div>ID: ${station.id}</div>
    <div>X: ${Math.round(station.x)}</div>
    <div>Y: ${Math.round(station.y)}</div>
  `;
}

function renderCalibrationMap() {
  const active = calState.stationMap.get(calState.activeStationId);
  calElements.map.innerHTML = `
    <image
      class="map-underlay"
      href="${calState.network.map.image_url}"
      x="0"
      y="0"
      width="${calState.network.map.width}"
      height="${calState.network.map.height}"
      preserveAspectRatio="xMidYMid meet"
    ></image>
    ${renderCalibrationOverlay(calState.overlay)}
    ${renderAllCalibrationStations()}
    ${active ? renderCrosshair(active) : ""}
  `;

  calElements.map.onclick = onMapClick;
}

function renderAllCalibrationStations() {
  return Array.from(calState.stationMap.values())
    .map((station) => {
      const active = station.id === calState.activeStationId ? "active" : "";
      return `
        <g>
          <circle class="cal-station-halo" cx="${station.x}" cy="${station.y}" r="24"></circle>
          <circle class="cal-station-core ${active}" cx="${station.x}" cy="${station.y}" r="13"></circle>
          <text class="cal-marker-label" x="${station.x + 32}" y="${station.y - 20}">${station.name}</text>
        </g>
      `;
    })
    .join("");
}

function renderCrosshair(station) {
  return `
    <g>
      <line class="cal-crosshair" x1="${station.x - 40}" y1="${station.y}" x2="${station.x + 40}" y2="${station.y}"></line>
      <line class="cal-crosshair" x1="${station.x}" y1="${station.y - 40}" x2="${station.x}" y2="${station.y + 40}"></line>
    </g>
  `;
}

function onMapClick(event) {
  if (!calState.activeStationId) {
    return;
  }

  const point = clientToSvgPoint(event, calElements.map);
  const station = calState.stationMap.get(calState.activeStationId);
  station.x = Math.round(point.x);
  station.y = Math.round(point.y);
  renderActiveStation();
  renderCalibrationMap();
  renderStationList();
}

function clientToSvgPoint(event, svg) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

async function saveCalibration() {
  const stations = Array.from(calState.stationMap.values()).map((station) => ({
    id: station.id,
    x: station.x,
    y: station.y,
  }));

  setCalibrationStatus("Đang lưu tọa độ…");
  const response = await fetch("/api/calibration/stations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stations }),
  });
  const body = await response.json();
  if (!response.ok) {
    setCalibrationStatus(body.detail || "Lưu thất bại.");
    return;
  }

  setCalibrationStatus(`Đã lưu ${body.updated_count} station.`);
}

function setCalibrationStatus(message) {
  calElements.statusText.textContent = message;
}

initCalibration();

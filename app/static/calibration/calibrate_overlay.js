function createCalibrationOverlayState(href) {
  return {
    href,
    ready: false,
    positioned: false,
    enabled: true,
    opacity: 0.42,
    naturalWidth: 0,
    naturalHeight: 0,
    viewBox: "",
    markup: "",
    rootStyle: "",
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

async function loadCalibrationOverlayMetadata(overlay) {
  try {
    const response = await fetch(overlay.href);
    if (!response.ok) {
      return false;
    }

    const raw = await response.text();
    const svg = new DOMParser().parseFromString(raw, "image/svg+xml").documentElement;
    const dimensions = resolveCalibrationOverlayDimensions(svg);
    if (!dimensions) {
      return false;
    }

    overlay.naturalWidth = dimensions.width;
    overlay.naturalHeight = dimensions.height;
    overlay.viewBox = svg.getAttribute("viewBox") || `0 0 ${dimensions.width} ${dimensions.height}`;
    overlay.markup = svg.innerHTML;
    overlay.rootStyle = svg.getAttribute("style") || "";
    overlay.ready = true;
    return true;
  } catch (error) {
    console.warn("Unable to load calibration overlay metadata.", error);
    return false;
  }
}

function resolveCalibrationOverlayDimensions(svg) {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value));
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const width = Number.parseFloat(svg.getAttribute("width") || "");
  const height = Number.parseFloat(svg.getAttribute("height") || "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }

  return null;
}

function fitCalibrationOverlayToMap(overlay, mapWidth, mapHeight) {
  if (!overlay.ready || !mapWidth || !mapHeight) {
    return;
  }

  const scale = Math.min(mapWidth / overlay.naturalWidth, mapHeight / overlay.naturalHeight);
  overlay.scale = roundCalibrationOverlayValue(scale, 4);
  overlay.offsetX = roundCalibrationOverlayValue(
    (mapWidth - overlay.naturalWidth * scale) / 2,
    2,
  );
  overlay.offsetY = roundCalibrationOverlayValue(
    (mapHeight - overlay.naturalHeight * scale) / 2,
    2,
  );
  overlay.positioned = true;
}

function resetCalibrationOverlay(overlay, mapWidth, mapHeight) {
  overlay.enabled = true;
  overlay.opacity = 0.42;
  fitCalibrationOverlayToMap(overlay, mapWidth, mapHeight);
}

function renderCalibrationOverlay(overlay) {
  if (!overlay.ready || !overlay.enabled) {
    return "";
  }

  const width = roundCalibrationOverlayValue(overlay.naturalWidth * overlay.scale, 2);
  const height = roundCalibrationOverlayValue(overlay.naturalHeight * overlay.scale, 2);
  return `
    <svg
      class="cal-guide-overlay"
      x="${overlay.offsetX}"
      y="${overlay.offsetY}"
      width="${width}"
      height="${height}"
      viewBox="${overlay.viewBox}"
      opacity="${overlay.opacity}"
      preserveAspectRatio="none"
      style="${overlay.rootStyle}"
    >
      ${overlay.markup}
    </svg>
  `;
}

function syncCalibrationOverlayControls(overlay, elements) {
  const controls = [
    elements.overlayEnabled,
    elements.overlayOpacity,
    elements.overlayScale,
    elements.overlayOffsetX,
    elements.overlayOffsetY,
    elements.overlayFitBtn,
    elements.overlayResetBtn,
  ].filter(Boolean);

  controls.forEach((control) => {
    control.disabled = !overlay.ready;
  });

  if (!overlay.ready) {
    return;
  }

  elements.overlayEnabled.checked = overlay.enabled;
  elements.overlayOpacity.value = Math.round(overlay.opacity * 100);
  elements.overlayOpacityValue.textContent = `${Math.round(overlay.opacity * 100)}%`;
  elements.overlayScale.value = overlay.scale.toFixed(2);
  elements.overlayOffsetX.value = Math.round(overlay.offsetX);
  elements.overlayOffsetY.value = Math.round(overlay.offsetY);
}

function bindCalibrationOverlayControls({ overlay, elements, renderMap, fitOverlay, resetOverlay }) {
  elements.overlayEnabled.addEventListener("change", () => {
    overlay.enabled = elements.overlayEnabled.checked;
    syncCalibrationOverlayControls(overlay, elements);
    renderMap();
  });

  elements.overlayOpacity.addEventListener("input", () => {
    overlay.opacity = Number(elements.overlayOpacity.value) / 100;
    syncCalibrationOverlayControls(overlay, elements);
    renderMap();
  });

  elements.overlayScale.addEventListener("input", () => {
    overlay.scale = Math.max(0.05, Number(elements.overlayScale.value) || overlay.scale);
    renderMap();
  });

  elements.overlayOffsetX.addEventListener("input", () => {
    overlay.offsetX = Number(elements.overlayOffsetX.value) || 0;
    renderMap();
  });

  elements.overlayOffsetY.addEventListener("input", () => {
    overlay.offsetY = Number(elements.overlayOffsetY.value) || 0;
    renderMap();
  });

  elements.overlayFitBtn.addEventListener("click", () => {
    fitOverlay();
    syncCalibrationOverlayControls(overlay, elements);
    renderMap();
  });

  elements.overlayResetBtn.addEventListener("click", () => {
    resetOverlay();
    syncCalibrationOverlayControls(overlay, elements);
    renderMap();
  });
}

function roundCalibrationOverlayValue(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

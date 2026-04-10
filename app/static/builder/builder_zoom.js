(() => {
  const BUILDER_ZOOM = {
    minScale: 1,
    maxScale: 8,
    step: 1.2,
    dragThreshold: 6,
  };

  const createBuilderZoomController = (surface, stage, source) => {
    const controller = {
      surface,
      stage,
      source,
      scale: 1,
      maxScale: BUILDER_ZOOM.maxScale,
      translateX: 0,
      translateY: 0,
      pointerId: null,
      dragStartX: 0,
      dragStartY: 0,
      dragOriginX: 0,
      dragOriginY: 0,
      moved: false,
      suppressClick: false,
    };

    surface.addEventListener("wheel", (event) => handleWheel(event, controller), {
      passive: false,
    });
    surface.addEventListener("pointerdown", (event) => startPan(event, controller));
    surface.addEventListener("pointermove", (event) => updatePan(event, controller));
    surface.addEventListener("pointerup", (event) => endPan(event, controller));
    surface.addEventListener("pointerleave", (event) => endPan(event, controller));
    surface.addEventListener("pointercancel", (event) => endPan(event, controller));

    syncBuilderZoomLayout(controller);
    return controller;
  };

  const setBuilderZoomSource = (controller, source) => {
    controller.source = source;
    syncBuilderZoomLayout(controller);
  };

  const syncBuilderZoomLayout = (controller) => {
    recalculateBounds(controller);
    clampPan(controller);
    applyTransform(controller);
  };

  const runBuilderZoomAction = (controller, action) => {
    if (action === "reset") {
      resetBuilderZoom(controller);
      return;
    }

    const rect = controller.surface.getBoundingClientRect();
    const factor = action === "zoom-in" ? BUILDER_ZOOM.step : 1 / BUILDER_ZOOM.step;
    zoomAroundPoint(controller, factor, rect.width / 2, rect.height / 2);
  };

  const resetBuilderZoom = (controller) => {
    controller.scale = 1;
    controller.translateX = 0;
    controller.translateY = 0;
    controller.pointerId = null;
    controller.moved = false;
    controller.suppressClick = false;
    controller.surface.classList.remove("is-dragging");
    applyTransform(controller);
  };

  const builderEventToDiagramPoint = (event, controller) => {
    const rect = controller.surface.getBoundingClientRect();
    const surfaceX = event.clientX - rect.left;
    const surfaceY = event.clientY - rect.top;
    const contentX = (surfaceX - controller.translateX) / controller.scale;
    const contentY = (surfaceY - controller.translateY) / controller.scale;

    return {
      x: roundToOneDecimal(clamp((contentX / rect.width) * controller.source.width, 0, controller.source.width)),
      y: roundToOneDecimal(clamp((contentY / rect.height) * controller.source.height, 0, controller.source.height)),
    };
  };

  const handleWheel = (event, controller) => {
    event.preventDefault();

    const rect = controller.surface.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? BUILDER_ZOOM.step : 1 / BUILDER_ZOOM.step;

    zoomAroundPoint(controller, factor, cursorX, cursorY);
  };

  const startPan = (event, controller) => {
    if (event.button !== 0 || controller.scale <= 1) {
      controller.moved = false;
      return;
    }

    controller.pointerId = event.pointerId;
    controller.dragStartX = event.clientX;
    controller.dragStartY = event.clientY;
    controller.dragOriginX = controller.translateX;
    controller.dragOriginY = controller.translateY;
    controller.moved = false;
    controller.surface.classList.add("is-dragging");
    controller.surface.setPointerCapture(event.pointerId);
  };

  const updatePan = (event, controller) => {
    if (controller.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - controller.dragStartX;
    const deltaY = event.clientY - controller.dragStartY;
    if (!controller.moved && Math.hypot(deltaX, deltaY) >= BUILDER_ZOOM.dragThreshold) {
      controller.moved = true;
    }

    controller.translateX = controller.dragOriginX + deltaX;
    controller.translateY = controller.dragOriginY + deltaY;
    clampPan(controller);
    applyTransform(controller);
  };

  const endPan = (event, controller) => {
    if (controller.pointerId !== event.pointerId) {
      return;
    }

    controller.surface.classList.remove("is-dragging");
    if (controller.surface.hasPointerCapture(event.pointerId)) {
      controller.surface.releasePointerCapture(event.pointerId);
    }

    controller.pointerId = null;
    controller.suppressClick = controller.moved;
    controller.moved = false;
  };

  const zoomAroundPoint = (controller, factor, anchorX, anchorY) => {
    const nextScale = clamp(controller.scale * factor, BUILDER_ZOOM.minScale, controller.maxScale);
    if (nextScale === controller.scale) {
      return;
    }

    const contentX = (anchorX - controller.translateX) / controller.scale;
    const contentY = (anchorY - controller.translateY) / controller.scale;
    controller.scale = nextScale;
    controller.translateX = anchorX - contentX * controller.scale;
    controller.translateY = anchorY - contentY * controller.scale;

    clampPan(controller);
    applyTransform(controller);
  };

  const recalculateBounds = (controller) => {
    const rect = controller.surface.getBoundingClientRect();
    if (!rect.width || !rect.height || !controller.source) {
      controller.maxScale = BUILDER_ZOOM.maxScale;
      controller.scale = clamp(controller.scale, BUILDER_ZOOM.minScale, controller.maxScale);
      return;
    }

    if (controller.source.is_vector) {
      controller.maxScale = Math.max(BUILDER_ZOOM.maxScale, controller.source.max_zoom || BUILDER_ZOOM.maxScale);
      controller.scale = clamp(controller.scale, BUILDER_ZOOM.minScale, controller.maxScale);
      return;
    }

    const limitByWidth = controller.source.raster_width / rect.width;
    const limitByHeight = controller.source.raster_height / rect.height;
    controller.maxScale = clamp(
      Math.min(limitByWidth, limitByHeight, controller.source.max_zoom || BUILDER_ZOOM.maxScale),
      BUILDER_ZOOM.minScale,
      controller.source.max_zoom || BUILDER_ZOOM.maxScale,
    );
    controller.scale = clamp(controller.scale, BUILDER_ZOOM.minScale, controller.maxScale);
  };

  const clampPan = (controller) => {
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
  };

  const applyTransform = (controller) => {
    controller.stage.style.width = `${controller.scale * 100}%`;
    controller.stage.style.height = `${controller.scale * 100}%`;
    controller.stage.style.transform = `translate(${controller.translateX}px, ${controller.translateY}px)`;
    controller.surface.classList.toggle("is-zoomed", controller.scale > 1);
  };

  const roundToOneDecimal = (value) => Math.round(value * 10) / 10;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  window.BuilderZoom = {
    createBuilderZoomController,
    setBuilderZoomSource,
    syncBuilderZoomLayout,
    runBuilderZoomAction,
    resetBuilderZoom,
    builderEventToDiagramPoint,
  };
})();

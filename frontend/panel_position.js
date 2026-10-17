(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartScreenPanelPosition = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function() {
  // Control panel placement: keep it fully inside the viewport, snap to edges, persist.
  const SNAP_PX = 24;

  function clampPosition(pos, size, viewport) {
    const maxX = Math.max(0, viewport.width - size.width);
    const maxY = Math.max(0, viewport.height - size.height);
    return {
      x: Math.round(Math.min(maxX, Math.max(0, Number(pos.x) || 0))),
      y: Math.round(Math.min(maxY, Math.max(0, Number(pos.y) || 0)))
    };
  }

  // On release: clamp, then snap any side within `threshold` px of a screen edge onto it.
  function snapToEdges(pos, size, viewport, threshold = SNAP_PX) {
    const p = clampPosition(pos, size, viewport);
    const maxX = Math.max(0, viewport.width - size.width);
    const maxY = Math.max(0, viewport.height - size.height);
    if (p.x <= threshold) p.x = 0;
    else if (maxX - p.x <= threshold) p.x = maxX;
    if (p.y <= threshold) p.y = 0;
    else if (maxY - p.y <= threshold) p.y = maxY;
    return p;
  }

  function serialize(pos) {
    return JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) });
  }

  // Returns {x, y} or null for missing/corrupt data (then the default placement is used).
  function parseStored(text) {
    if (typeof text !== 'string' || !text) return null;
    try {
      const value = JSON.parse(text);
      if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
      return { x: value.x, y: value.y };
    } catch {
      return null;
    }
  }

  // Elements that keep their own pointer behaviour; dragging starts anywhere else in the panel.
  const NO_DRAG_SELECTOR = 'button, input, select, textarea, a, label, img, [contenteditable]';

  return { SNAP_PX, NO_DRAG_SELECTOR, clampPosition, snapToEdges, serialize, parseStored };
});

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartScreenIntensity = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function() {
  // Universal Privacy Intensity: one 0–100 level drives every effect.
  const DEFAULT_LEVEL = 50;

  // [at level 0, at level 100]
  const RANGES = Object.freeze({
    blurPx: [4, 30],
    pixelBlockPx: [8, 48],
    blackoutOpacity: [0.70, 1.0],
    focusDarkness: [0.20, 0.95],
    dimOpacity: [0.05, 0.45],
    vignetteOpacity: [0.30, 0.90]
  });

  function clampLevel(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) return DEFAULT_LEVEL;
    return Math.min(100, Math.max(0, Math.round(n)));
  }

  function lerp([from, to], t) {
    return from + (to - from) * t;
  }

  function computeIntensity(level) {
    const value = clampLevel(level);
    const t = value / 100;
    return Object.freeze({
      level: value,
      blurPx: Math.round(lerp(RANGES.blurPx, t)),
      pixelBlockPx: Math.round(lerp(RANGES.pixelBlockPx, t)),
      blackoutOpacity: Number(lerp(RANGES.blackoutOpacity, t).toFixed(3)),
      focusDarkness: Number(lerp(RANGES.focusDarkness, t).toFixed(3)),
      dimOpacity: Number(lerp(RANGES.dimOpacity, t).toFixed(3)),
      vignetteOpacity: Number(lerp(RANGES.vignetteOpacity, t).toFixed(3))
    });
  }

  return Object.freeze({ DEFAULT_LEVEL, RANGES, clampLevel, computeIntensity });
});

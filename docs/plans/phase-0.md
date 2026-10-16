# Plan — Phase 0 (audit fixes) verification

Phase 0 code is already committed (3bf0388). What remains is verifying it at app level and in a live check.

## Automated (e2e, `tests/e2e/phase0.spec.js` + `protection.spec.js`)
- §1 Event history reads `activity.log` at startup (fix #1).
- §2 Startup: intensity value shown, identity button reads "Re-enroll Owner" (fix #2).
- §3 Exactly one intensity slider; it drives blur px, blackout opacity, focus/vignette darkness and pixelate
  block size live; slider drag doesn't move the panel; header drag moves the panel and is clamped on screen;
  intensity survives a restart (fix #3).
- §4 Pixelate layer shows a pixelated capture with the block size from the intensity (fix #4).
- §5 Camera error → "Camera unavailable" (not overwritten by the exit); crash/watchdog → "Protection unavailable" (fix #5).
- §6/§7 One overlay per display, each covering the full display bounds (incl. taskbar) (fix #7).

## Live check (needs hardware / eyes)
Real webcam unplug, killing the real Python backend, taskbar coverage by eye, click-through after a slider
drag outside the panel, pixelate unreadability and capture exclusion, second monitor hot-plug (if available).

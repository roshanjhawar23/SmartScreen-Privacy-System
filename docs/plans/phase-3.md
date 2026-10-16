# Plan — Phase 3: Advanced Security

## Build
1. **Tracking with identity stability** (`backend/face_tracker.py`): IoU matching plus SFace-embedding
   re-identification of tracks lost within 2 s; per-track identity = median of the last 5 owner
   similarities vs. the threshold, so owner/unknown no longer flickers per frame. Owner/unknown
   counts in STATE come from the smoothed track roles.
2. **Liveness heuristic** (`backend/liveness.py`, honestly labelled): per track over a ~2 s window:
   landmark micro-motion (non-rigid shape change), an eye-region blink cue, a moiré / screen texture
   check (FFT peak ratio) and a per-face frozen-crop check → `LIVE` / `SUSPECT` / `UNKNOWN`.
   Presence Gate option `presenceGate.requireLiveness` (default on): the owner must be `LIVE` to reveal.
   Documented: stops printed photos, phone photos held still and frozen images; does **not** reliably
   stop replayed video or masks with an RGB webcam.
3. **Threat score** (`electron/threat_score.js`, pure): 0–100 from unknown-face count, attention and
   exposure, distance (face size), liveness, sensitive app and a profile multiplier, with components
   for explanation. The policy engine maps profile score bands to actions; the stronger of the
   Phase 2 time rule and the score band wins.
4. **Anomaly / tamper**, each its own event; tamper while protected → FAILSAFE:
   camera covered (`TAMPER|camera-covered`), frozen feed (`TAMPER|feed-frozen`), camera device
   changed (renderer `devicechange` → `TAMPER|camera-device-changed`), AI restart loop (≥ 3 failures
   in 10 min → `TAMPER|ai-restart-loop`), `settings.json` / `policies.json` changed while running
   (HMAC-SHA256 with a random key stored via `safeStorage` → `TAMPER|config-modified`), system clock
   jump (wall vs. monotonic clock, reset across sleep → `TAMPER|clock-jump`, FAILSAFE above 5 min).
5. **Local telemetry**: backend `STATS|...` every 10 s (fps, frame and recognition latency avg/p95,
   CPU of the vision process); main adds Electron CPU/memory and event counters. A compact
   Diagnostics section in the panel; Export writes a JSON file chosen by the user. Nothing leaves the
   device; the export never contains images, embeddings or window titles.

## Tests
- Python: tracker re-identification and identity smoothing; liveness on synthetic sequences (still
  photo, moving face, moiré pattern, blink trace); STATS accumulator; tamper line before camera errors.
- Node: threat score table; policy engine with score bands; integrity HMAC; clock-jump monitor;
  restart-loop counter; diagnostics counters/export content; gate liveness requirement.
- e2e (mock backend): liveness SUSPECT never reveals; tamper events → FAILSAFE (config edit, clock jump
  via test hook, device change via test hook, restart loop); diagnostics view and export.
- Live check (batched with Phase 2): photo of the owner on a phone held still → not revealed;
  real face → revealed; cover the camera; edit settings.json while running.

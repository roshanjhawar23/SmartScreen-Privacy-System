# Plan — Phase 2: Intelligent Privacy

## Build
1. **Head pose** (`backend/head_pose.py`, pure): YuNet's 5 landmarks → roll-corrected 2D-ratio estimate of
   yaw/pitch on a generic face model (nose depth and drop relative to inter-ocular distance; configurable
   `headPose` constants). `solvePnP` is not used: it needs camera intrinsics we don't have, and with 5
   landmarks it is no more accurate. Classification `FACING_SCREEN` / `GLANCING` / `AWAY` by configurable
   yaw/pitch limits.
2. **Exposure tracking** (`backend/face_tracker.py`, pure): greedy IoU tracker with stable IDs; per track
   `presentMs`, `facingMs` (continuous FACING), `lookingMs` (continuous FACING or GLANCING).
   STATE lines gain `facing=`, `yaw=`, `pitch=` (most attentive unknown, else owner) and
   `tracks=<id>:<O|U>:<facing>:<yaw>:<pitch>:<presentMs>:<facingMs>:<lookingMs>,...`.
3. **Active app** (`electron/active_window.js`): foreground process name + title via koffi (user32/kernel32),
   polled every 1 s only while protection is active; SmartScreen's own windows are ignored.
   Titles are matched in memory and never logged (privacy); only the app category is logged.
4. **Policies + profiles**: `config/policies.json` with `Home`, `Office`, `Public` (custom profiles allowed):
   escalation thresholds (normal and sensitive app), presence-only thresholds for unknowns not looking,
   `glancingCounts`, `curtainEffect`, `walkAwayLockDelay`; `sensitiveApps` categories (process globs, title
   keywords). Active profile persisted in userData; switch from a compact panel dropdown and the tray.
5. **Policy engine** (`electron/policy_engine.js`, pure): `(identity state, tracks, active app, profile,
   threatDurationMs)` → `{ action: NONE|BLUR|FOCUS|LOCK, reason, factors[] }`. Replaces the fixed threat
   timers in `protection_sequence.js` (evaluated on every backend update, ~400 ms; no new timer system).
   Without track data it falls back to "unknown facing since the threat began" (old behaviour).
   Every escalation is logged as `POLICY_DECISION|action=...|reason=...` and shown in the event history.

## Tests
- Python: head-pose math on a synthetic 3D face (yaw/pitch/roll grid, ±5° tolerance), classification,
  tracker IDs/IoU/exposure, STATE message fields.
- Node: policy engine scenario table; sensitive-app matcher; profile loading/validation/persistence;
  protocol parsing of `tracks=`; protection sequence driven by decisions.
- e2e (mock backend with tracks): unknown AWAY escalates slower than FACING; sensitive app (injected
  test-mode foreground app) escalates faster; profile switch changes thresholds and curtain effect;
  reasons shown in the event history.
- Live check: real head turns (facing/glancing/away), real foreground apps (Outlook, browser banking title).

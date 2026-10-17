# SmartScreen Privacy Suite — project rules for Claude Code

SmartScreen is a local-first Windows 10/11 privacy app. It recognizes the
enrolled owner through the webcam, detects when someone else may be looking at
the screen, and applies privacy effects or locks the Windows session.
It has to run CPU-only on ordinary laptops, offline, with no cloud services.

## Architecture (keep it)
- `backend/face_detection.py`: Python + OpenCV vision loop. It uses YuNet (detection)
  and SFace (recognition) and emits line messages on stdout: `AI_READY`,
  `AI_HEARTBEAT`, `STATE|<STATE>|k=v...`, `PHOTO_SAVED|path`, `AI_ERROR|<KIND>|msg`.
  It reads one JSON config line on stdin, then `STOP`.
- `backend/enroll_face.py`: builds the owner template from 5 samples.
- `electron/main.js`: main process. It owns the app lifecycle, the AI process, the
  watchdog, all protection timers (escalation, walk-away, cancellation), Windows
  locking, logging and the tray. **Timers and high-impact actions live here, never
  only in the renderer.**
- `electron/preload.js`: contextBridge API (`window.electronAPI`). Callbacks get a single payload.
- `frontend/renderer.js` + `index.html` + `style.css`: transparent fullscreen
  overlay plus the compact control panel. It renders effects and shows state.
- `frontend/privacy_state.js`: shared state vocabulary (UMD, also used by tests).
- `frontend/intensity.js`: universal Privacy Intensity mapping (0–100 → every effect).
- `electron/security_events.js`: parses `activity.log` into the event history.
- `electron/biometric_store.js`: owner template, encrypted with Electron `safeStorage`.
- `config/settings.json`: tunable delays and thresholds.

Identity states: `INACTIVE, STARTING, OWNER_PRESENT, UNKNOWN_PERSON, UNKNOWN_GROUP
(= multiple unknown), OWNER_AND_UNKNOWN, NO_USER, CAMERA_ERROR, AI_UNAVAILABLE`.
Protection logic reacts to these states. It must not re-interpret camera frames
in multiple places, and there must be only one face-recognition pipeline.

## Non-negotiable rules
1. This repo is the single source of truth. Make incremental changes and never
   rewrite a working component just to add a feature.
2. **Fail closed.** A camera error, AI crash, watchdog timeout, unknown state or
   uncertain recognition must never be treated as "owner present" and must never
   reveal protected content.
3. SmartScreen never unlocks Windows and never bypasses Windows authentication.
   It may lock Windows, and it may show or hide its own privacy curtain.
4. Never commit biometric or personal data: enrolled templates, camera images,
   `Intruder_Logs/`, `intruder_logs/`, runtime logs, `device_profile.json`,
   `*.backup*`. Check `git status` before every commit.
5. The UI stays compact and professional: no emoji controls, no login screens,
   no extra sliders. Every effect strength comes from the one Privacy Intensity slider.
6. Keep it CPU-first and offline. Any new model or package must be CPU-capable, have a
   license compatible with distribution, and be recorded in `docs/DEPENDENCIES.md`.
7. Be honest about guarantees. Don't call a heuristic "anti-spoofing" or a
   similarity score a "probability". Document limits in `docs/SECURITY.md`.

## Workflow for every change
- Read the relevant code before editing. Prefer small, reviewable diffs.
- Put new logic in pure modules (no Electron imports) so it can be unit-tested with
  `node tests/*.test.js` and `python -m pytest backend/tests`.
- Run `npm test` (and the Python tests) before every commit. All must pass.
- For anything that needs the webcam, the overlay or Windows locking, write a manual
  checklist in `docs/testing/<phase>.md` and ask the user to run it. Don't claim it works
  until the user confirms.
- Commit at the end of each step, with a clear message. Tag a phase
  (`phase-X-complete`) only after the user confirms the manual checklist passed.
- Every protection decision is logged to `activity.log` with a reason, so it can be
  explained in the event history.

## Commands (Windows, PowerShell)
- `npm start`: run the app (dev, uses system `python`)
- `npm test`: Node unit tests
- `python -m pytest backend/tests`: Python unit tests
- `node scripts/runtime_health.js`: dependency check
- `npm run build`: electron-builder (Phase 5)

# Phase 5 live check — results (2026-10-17, installed build v1.0.0)

Installed from `dist/SmartScreen Privacy Suite Setup 1.0.0.exe` (per-machine, Program Files) on the
development laptop. "Log" = confirmed in `activity.log`; "owner" = the owner reported it passed but
`activity.log` holds no entry for it.

| Check | Result | Evidence |
|---|---|---|
| A1 install, startup health | pass | log: `SYSTEM_HEALTH` all true |
| A2 packaged AI starts, no Python window | pass | log: `AI_READY` 1.1–3.8 s after enabling |
| A3 owner recognized, screen revealed | pass | log: `OWNER_PRESENT` score 0.46–0.83, `REVEALED` |
| A4 leave → curtain, walk-away armed, cancelled on return | pass | log: `CONCEALED`, `WALK_AWAY_TIMER_ARMED`, `CANCELLED` |
| A5 unknown face next to the owner | owner | two attempts with a phone photo were not detected as a face (log: `faces=1` throughout) |
| A6 walk-away locks Windows | owner | no `LOCK_REQUESTED` after install |
| A7 enrollment via packaged AI | owner | no enrollment entry after install; `enroll` mode dispatch checked by hand on the exe |
| A8 diagnostics version | owner | |
| B1 plaintext migration | pass | log: `EVIDENCE_MIGRATED|encrypted=30|plaintextDeleted=38`; folder empty, 30 `.enc` |
| B2–B6 opt-in notice, encrypted save, viewer, discard | owner | no `EVIDENCE_SETTING` / `PHOTO_SAVED` after install |
| C desktop follow ≤ 250 ms | owner | no `OVERLAY_DESKTOP_FOLLOW` after install |
| New icon (installer, shortcut, taskbar, tray) | owner | |
| Panel drag + snap + persist; Manage layout | owner | also covered by e2e `panel.spec.js` |

Notes
- Vision CPU in the installed build: 440–490 (summed % across cores, 15 fps, recognition ~73 ms),
  higher than dev runs (130–380). Worth profiling after release.
- Unknown-face detection with a phone photo is unreliable (small, reflective); the e2e suite covers
  `OWNER_AND_UNKNOWN` handling with the mock backend.

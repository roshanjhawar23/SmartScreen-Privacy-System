# Live re-test of Phases 0–3 after the Electron 28 → 44.5.1 upgrade

Date: 2026-10-17, 01:20–01:26 local. Windows 11 Home 10.0.26300, HP Wide Vision HD camera.
Evidence: `activity.log`, desktop screenshots, window display-affinity readout, owner confirmations.

## Automated (Electron 44.5.1)
- Unit 163 pass; pytest 127 pass; e2e 69/69 pass on the first run (7 video tests pending).
- No deprecation or Electron security warnings in the app output.

## Live

| # | Item | Phase | Result | Evidence |
|---|---|---|---|---|
| 1 | Owner reveal; trusted templates decrypt under Electron 44 | 1.5 / 3 / 4 | ✅ | similarity 0.71; revealed. Liveness took 7.6 s this time (owner sitting still) — see findings |
| 2 | Walk-away → conceal → real Windows lock | 0 / 1.5 | ✅ | conceal 1.5 s after leaving; `LOCK_COMMAND_COMPLETED`, `SESSION_LOCKED` |
| 3 | No reveal while locked | 1.5 | ✅ | recognised (incl. LIVE) at the lock screen for 13 s, no reveal; revealed 1.8 s after sign-in |
| 4 | Blackout covers desktop and taskbar | 0 | ✅ | screenshot mean 0.0 for desktop and taskbar strip |
| 5 | Overlay follows a virtual-desktop switch | 1.5 | ✅ with finding | `moved=true|via=probe` 0.94 s after Win+Ctrl+→; Desktop 2 visible at 0.3 s, covered at 2 s; follows back |
| 6 | Pixelate unreadable; overlay excluded from capture | 0 | ✅ | owner: text unreadable; display affinity `0x11` (WDA_EXCLUDEFROMCAPTURE) |

## Findings
- **Session events fire twice on Electron 44** (`SESSION_LOCKED`/`UNLOCKED` 13–23 ms apart). Harmless for
  the gate; now de-duplicated (one per second), e2e asserts a single log line.
- **Desktop-follow gap up to ~1 s** with the 1 s poll. Poll is now 250 ms (cheap COM call); expected gap
  ≤ ~0.4 s. Covered by unit/e2e; **not yet re-measured on a real switch**.
- **Liveness relies on head movement only on this webcam**: in every live run the reason was
  `head-movement`, never `blink`; a still owner waited 7.6 s. Not caused by the upgrade.

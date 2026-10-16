# Phase 0 — results

Date: 2026-10-16. Windows 11 Home 10.0.26300, one display (1920×1080, 125 %).

## Automated
- Unit: `npm test` 46 pass + 1 todo (fail-open, Phase 1.5); `pytest` 36 pass.
- e2e (`npm run test:e2e`, real app, mock backend): 23 pass, incl. `phase0.spec.js` §1–§7 and
  4 expected failures for fail-open (Phase 1.5). 7 video face-recognition tests pending (no owner fixture).

## Live check (real mode, real webcam; evidence: activity.log + desktop screenshots)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Event history shows real history at startup | ✅ | Screenshot: "Owner verified", "Screen locked" |
| 2 | Identity button "Re-enroll Owner" at startup | ✅ | Screenshot |
| 3 | Owner verified after Enable | ✅ | `OWNER_PRESENT` 0.7 s after `AI_READY`, ownerScore 0.68 |
| 4 | Walk-away → real Windows lock | ✅ | `LOCK_REQUESTED` → `LOCK_COMMAND_COMPLETED`; owner confirmed Windows locked |
| 5 | Walk-away return cancels without lock | ✅ | `NO_USER` → 1.9 s → `PROTECTION_SEQUENCE_CANCELLED|type=WALK_AWAY|reason=owner-returned` |
| 6 | Backend killed → "Protection unavailable" | ✅ | `AI_EXIT|code=1`; panel "Protection unavailable / Verification unavailable" |
| 7 | Camera access off at start → "Camera unavailable" | ✅ | `AI_ERROR|CAMERA_ERROR|No accessible camera was found.` ×3 |
| 8 | Camera access revoked mid-stream → "Camera unavailable" | ❌ → fixed, **re-test pending** | Reported `NO_USER` (frames kept arriving) → walk-away lock. Fixed in 35498dd (ImageHealth). |
| 9 | Crash shown in event history | ❌ → fixed (35498dd), seen live ✅ | Panel: "Privacy recognition service stopped unexpectedly" |
| 10 | Blackout covers taskbar (by eye) | not run | e2e verifies window bounds = display bounds |
| 11 | Pixelate unreadable, no panel copy in capture | not run | e2e screenshot: unreadable; a faint shape behind the panel needs an eye check |
| 12 | Slider drag outside panel, then click-through | not run | e2e verifies drag; click-through needs a human |
| 13 | Second monitor | N/A | one display |

Owner chose to continue building; items 8, 10–12 move into the Phase 1.5 live check.
Phase 0 is not tagged until they pass.

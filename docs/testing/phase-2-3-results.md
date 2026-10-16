# Live check — Phases 0–3 (combined), results

Date: 2026-10-16, 19:27–19:58 local. Windows 11 Home 10.0.26300, one display 1920×1080 @125 %,
HP Wide Vision HD camera, normal indoor lighting. Evidence: `activity.log`, desktop screenshots,
controlled test-mode measurements, owner confirmations.

## Results

| # | Item | Phase | Result | Evidence |
|---|---|---|---|---|
| 1 | Owner reveal on the real webcam | 1.5 / 3 | ✅ after fix | Run 1: liveness flagged the real face SUSPECT in 0.8 s (moiré cue) → reveal after ~10 s, then re-concealed. Fixed in 109bcbd (moiré opt-in). Run 2: LIVE 0.8 s after first sight, revealed 4.5 s after Enable; run 3 (sitting still): LIVE 3.4 s, revealed 5.2 s after first sight. Stayed revealed afterwards. |
| 2 | Liveness lets the owner through quickly in normal lighting | 3 | ✅ | 0.8–3.4 s to LIVE (`LIVENESS|track=…|state=LIVE|reason=head-movement`) |
| 3 | Walk-away: conceal after grace | 1.5 | ✅ | `ABSENCE_GRACE` → `CONCEALED owner-absent` in 1.52 s (×4) |
| 4 | Walk-away: real Windows lock | 0 / 1.5 | ✅ | `LOCK_REQUESTED` → `LOCK_COMMAND_COMPLETED` → `SESSION_LOCKED` 19:43:06; owner confirmed |
| 5 | Short absences do not lock | 1.5 | ✅ | returns after 1.4–5 s → `PROTECTION_SEQUENCE_CANCELLED|type=WALK_AWAY|reason=owner-returned` |
| 6 | No reveal while Windows is locked | 1.5 | ✅ | owner recognised at the lock screen for 24 s: no `VERIFYING`/`REVEALED` until `SESSION_UNLOCKED`; revealed 2.4 s after sign-in |
| 7 | Pixelate: no copy of the panel in the pixelated image | 0 | ✅ | Controlled test (white window behind, real capture): canvas under/around the panel stays white (253/255), frames live (animated test square alternates). Earlier dark readings came from the *real* app's panel captured by a second instance. Screenshot around the moved panel shows only its soft drop shadow. Owner did not remember whether the shape was soft or blocky. |
| 8 | Overlay follows a virtual-desktop switch | 1.5 | ✅ after fix | Run 1: Desktop 2 fully uncovered (`moved=false`). Fixed in 1370b7b (probe window). Real Win+Ctrl+→: Desktop 2 black at 0.3 s (`moved=true|via=probe`), and back. |
| 9 | Head pose plausible | 2 | ✅ | natural movement logged FACING (|yaw| ≤ 20°), GLANCING (21–40°), AWAY (46–60°) |
| 10 | Profile switching (panel) | 2 | ✅ | Office → Home → Office → Public → Home logged; persisted across restarts |
| 11 | Sensitive app detection, no title logged | 2 | ✅ | Gmail in Edge → `SENSITIVE_APP_ACTIVE|category=Email|app=Msedge`; File Explorer → `INACTIVE`; 0 title fragments in the log |

## Findings (not blocking)
- Owner briefly classified as unknown while walking back into view (similarity 0.31 < 0.363) → blur and
  an evidence photo of the owner; recognised 1.4 s later, threat cancelled, no lock. Threshold calibration
  for this camera is a later improvement.
- Liveness by head movement triggers within 0.8–3.4 s on this webcam, partly from landmark jitter; it is
  weak evidence (documented in `docs/SECURITY.md`).
- App display name from the executable is crude ("Msedge").
- Vision CPU 135–140 % of one core at 15 fps camera with moiré on (before the fix); re-measure in Phase 5.
- Not covered live: second monitor (one display; secondary overlays are tool windows, which get no
  virtual-desktop assignment), tray profile switch, click-through after a slider drag.

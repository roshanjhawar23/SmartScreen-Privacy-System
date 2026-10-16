# Phase 1.5 — results (Presence Gate)

Date: 2026-10-16. Windows 11 Home 10.0.26300, one display 1920×1080 @125 %, HP Wide Vision HD camera.

## Automated
- Unit: `npm test` 73 pass (18 Presence Gate tests + fail-closed sequence tests; Phase 0 `todo` now passes).
- Python: 40 pass (periodic state updates, ImageHealth).
- e2e (real app, mock backend): 43 pass, 7 pending (video face recognition, no owner fixture).

## Live check (real mode; evidence: activity.log, desktop screenshots, owner confirmations)

### A. Real webcam
| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Curtain up on Enable, reveal after verification | ✅ | `CONCEALED protection-enabled` → `VERIFYING` → `REVEALED` 1.29–1.41 s later (4 runs) |
| 2 | Short look-away stays revealed | ✅ | `ABSENCE_GRACE` → `REVEALED owner-returned` after 0.9 s, no conceal |
| 2b | Step away → concealed after grace; walk-away lock | ✅ | grace 1.52 s → `CONCEALED owner-absent`; real `LOCK_COMMAND_COMPLETED` |
| 3 | Return → revealed only after verification | ✅ | `VERIFYING` → `REVEALED` |
| 4 | Camera access revoked mid-stream → FAILSAFE, no lock | ✅ | `CAMERA_ERROR … (dark, mean=0.0, std=0.3)` → `FAILSAFE camera-error`; walk-away halted |
| 4b | Retry while the camera is still blocked stays concealed | ✅ | 3× `PROTECTION_RETRY` → `CAMERA_ERROR` → `FAILSAFE` |
| 5 | Retry after a backend kill → re-verify → reveal | ✅ | `FAILSAFE backend-exit` (screen mean 0.0) → Retry → `REVEALED` 3.8 s later |
| 6 | After a Windows lock + sign-in: concealed until verified | ✅ (found + fixed) | Run 1 revealed behind the lock screen (lock arrived while already concealed). Fixed in 8e6eb3e; unit + e2e tested, **not yet re-run live** |
| 7 | Disable Protection removes the curtain | ✅ | `DISABLED protection-disabled` |

### B. Coverage matrix (curtain = Blackout overlay at full strength)
| Surface | Covered? | Evidence |
|---|---|---|
| Desktop, windows, taskbar | ✅ | screenshot mean 0.0 |
| Fullscreen browser video | ✅ | screenshot mean 0.0; owner confirmed video was fullscreen underneath |
| Start menu | ❌ | shown above the overlay (incl. Recommended files) |
| Alt+Tab | ❌ | shown above, with live window thumbnails |
| Win+Tab task view | ❌ | shown above, with readable thumbnails |
| Other virtual desktops | ❌ | Desktop 2 has no overlay at all (`setVisibleOnAllWorkspaces` is a no-op on Windows) |
| Notification toast | ❌ | owner saw and could read it |
| UAC prompt, Ctrl+Alt+Del | not run | secure desktop; shows no app content |
| Display sleep/wake, sleep/resume | not run | `resume` handler unit + e2e tested |
| Fullscreen game / exclusive fullscreen, RDP | not run | — |
| Second monitor | N/A | one display |

### C. Carried over from Phase 0
| Item | Result | Evidence |
|---|---|---|
| Blackout covers the taskbar | ✅ | screenshot |
| Pixelate makes text unreadable | ✅ | owner |
| No pixelated copy of the panel | ? unresolved | Owner reported a blocky copy. Overlay affinity read as `0x11` (WDA_EXCLUDEFROMCAPTURE) while on; an isolated diagnostic found the canvas under the panel matches the surrounding desktop and no copy follows a moved panel. Likely a dark window behind the panel; owner's confirmation (does the copy follow the panel?) pending. |
| Click-through after slider drag | not run | e2e covers the drag |
| Tray Hide Overlay refused while concealed | not run | code path + log line `OVERLAY_HIDE_REFUSED` |
| Camera blocked mid-stream → Camera unavailable (Phase 0 #8) | ✅ | see A4 |

Owner chose to continue building. Phase 0 and Phase 1.5 stay untagged until the owner accepts these results.

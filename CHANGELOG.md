# Changelog

## 1.0.0 — 2026-10-17
First public release. Windows 10/11, CPU-only, offline.

### Added
- **Core protection (Phase 1):** owner enrollment (5 samples, YuNet + SFace), identity states,
  privacy overlay on every display, escalation and walk-away lock, event history.
- **Presence Gate (Phase 1.5):** fail-closed privacy curtain; camera errors, AI crashes and watchdog
  timeouts never count as "owner present".
- **Intelligent privacy (Phase 2):** head pose / looking-away, exposure time, sensitive-app awareness,
  built-in profiles, universal Privacy Intensity slider.
- **Advanced security (Phase 3):** face tracking, liveness heuristic (blink / head movement), threat
  score, tamper and anomaly events, diagnostics, Windows session lock/unlock logging, virtual-desktop
  follow.
- **Productization (Phase 4):** trusted people (up to 10), custom profiles with Wi-Fi auto-switch,
  enterprise policy file, encrypted settings export/import.
- **Release (Phase 5):** Electron 44.5.1; security images opt-in and encrypted with `safeStorage`
  (newest 30, never the owner, in-app viewer); MIT license; NSIS installer with a one-folder
  PyInstaller AI service; explicit packaging allow-list; third-party notices.
- **Panel:** Enable/Disable Protection is pinned at the top; Manage and Diagnostics scroll inside
  their own section and never overlap other content; the panel never exceeds the screen height. The
  panel drags from its header or any empty area, snaps to screen edges within 24 px and remembers
  its position.
- **Icon:** original shield-and-lens icon (master SVG) for the app, taskbar, installer and shortcuts;
  tray variants by state: green active, red threat, grey inactive, amber failsafe.

### Security
- Self-test switches (`SMARTSCREEN_TEST` etc.) are ignored by installed builds.
- Plaintext intruder snapshots from earlier versions are encrypted (newest 30) and deleted on start.

### Known limits
See [docs/SECURITY.md](docs/SECURITY.md#known-limits-summary).

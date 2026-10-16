# Phase 1.5 — live check (Presence Gate)

Automated coverage (mock backend, real app): `tests/e2e/presence_gate.spec.js`, rules 1–9 plus toggle-off
fail-closed; `tests/e2e/protection.spec.js` fail-closed for camera error, crash, watchdog and camera loss while away.
The live check covers what needs the real webcam, Windows and a human eye. Claude drives it step by step,
watching `activity.log` and taking desktop screenshots; the owner only confirms what Claude can't observe.

## A. Real webcam
1. Enable protection: blackout appears immediately, then the screen is revealed ~1.5 s after sitting in front.
2. Look away / step aside briefly (< 1.5 s): stays revealed. Step away: concealed after the grace, walk-away lock later.
3. Return before the walk-away lock: the screen is revealed again only after verification.
4. Revoke camera access mid-stream (Settings → Privacy → Camera): "Camera unavailable — screen protected" (Phase 0 item 8).
5. Re-allow camera, press **Retry**: concealed → owner verified → revealed.
6. Walk-away lock → sign in again: screen still concealed until verified (never unlocked by SmartScreen).
7. Disable Protection (confirm): curtain removed.

## B. Coverage matrix (curtain up via an unknown or absent state)
Record **covered / not covered** for each:
Start menu · Alt+Tab · Win+Tab task view · notifications/toasts · fullscreen video (browser F11 / video player) ·
fullscreen game or exclusive-fullscreen app · UAC prompt · Ctrl+Alt+Del · display sleep/wake ·
sleep/hibernate resume · RDP (if available) · second monitor (N/A: one display).

## C. Carried over from Phase 0
- Blackout covers the taskbar (by eye).
- Pixelate: text unreadable; no pixelated copy of the control panel in the top-right corner.
- Slider drag outside the panel, release: clicks go through to the desktop again.
- Tray → Hide Overlay while concealed: refused (`OVERLAY_HIDE_REFUSED` in the log).

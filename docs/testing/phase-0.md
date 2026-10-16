# Phase 0 — manual test checklist

Automated coverage: `npm test` (JS, 35 pass + 1 expected `todo`) and `npm run test:py` (17 pass,
including a smoke test that runs the real YuNet/SFace models on a fake camera).
This checklist covers what needs a real webcam, real displays or a human eye.

Mark each item ✅ / ❌ and add a note for anything that fails.

## Setup

- [ ] `npm start` launches with no errors in the terminal.
- [ ] DevTools console: start with `npx electron . --remote-debugging-port=9333`, open
      `chrome://inspect` in Chrome → Configure → add `localhost:9333` → inspect "SmartScreen".
      No red errors on startup.

## 1. Security event history (fix #1)

- [ ] The "LAST EVENT" area in the panel shows recent events (not "No security events recorded"
      if you have used the app before). Previously this always failed with
      `readSecurityEvents is not defined`.

## 2. Renderer startup (fix #2)

- [ ] Right after launch (without re-enrolling), the intensity value reads `50` (or your last value)
      and the identity button reads "Re-enroll Owner".
- [ ] Enable protection, wait 15 s: events keep refreshing (the list updates when your state changes).

## 3. Universal Privacy Intensity (fix #3)

Open **Effects** in the panel.

- [ ] There is exactly one slider, "Privacy intensity", 0–100.
- [ ] Turn on **Blur**: moving the slider changes blur strength live.
- [ ] Turn on **Blackout**: slider changes opacity (still dark at 0, fully black at 100).
- [ ] Turn on **Focus** and **Vignette**: slider changes darkness of both.
- [ ] Turn on **Pixelate**: slider changes block size (larger blocks at higher values).
- [ ] Dragging the slider does **not** move the panel.
- [ ] Press on the slider, drag the pointer far outside the panel (left, across the screen),
      keep moving: the slider keeps following until you release.
- [ ] After releasing outside the panel, clicks go through to the desktop again (overlay is click-through).
- [ ] Dragging the panel by its header (the "SmartScreen" title area) still moves it, and it can't be
      dragged off-screen.
- [ ] Restart the app: the intensity value is remembered.

## 4. Pixelate really obscures (fix #4)

- [ ] Open a text-heavy window (e.g. this file in Notepad). Turn on **Pixelate**: text is unreadable
      at intensity 0 and at 100.
- [ ] The pixelated image updates when content underneath changes (e.g. scroll the document or play a video):
      expect ~8–10 updates/s.
- [ ] The control panel itself does **not** appear inside the pixelated image (top-right corner
      shows pixelated desktop, not a dark copy of the panel). If you do see a pixelated copy of the panel,
      capture exclusion is not working on your Windows build — note your Windows version.
- [ ] For a split second when turning pixelate on you see a solid dark cover, never the raw screen.
- [ ] Optional: while pixelate is on, start a Teams/Zoom/OBS screen share. Note what the share shows
      (expected: the raw screen — the overlay is excluded from capture while pixelate is on.
      This is documented as a limitation).

## 5. Camera failure and watchdog (fix #5)

Enable protection first, sit in front of the camera until "Owner verified".

- [ ] **Unplug the webcam** (or disable it in Device Manager). Within ~3–5 s the panel shows
      "Camera unavailable" and the event list shows "Camera unavailable".
      Check `%APPDATA%\smartscreen-privacy-suite\logs\activity.log` contains `AI_ERROR|CAMERA_ERROR|`.
- [ ] Status stays "Camera unavailable" (it must not flip to "Protection unavailable").
- [ ] Re-plug the webcam, click **Enable Protection** again: works.
- [ ] **Kill the backend**: Task Manager → find `python.exe` running `face_detection.py` → End task.
      Panel shows "Protection unavailable"; log has `AI_EXIT|code=1` (or similar).
- [ ] Optional (needs Sysinternals `pssuspend`): `pssuspend python.exe` while protection is on.
      Within ~15 s the log shows `AI_WATCHDOG_TIMEOUT` and the panel shows "Protection unavailable".
      `pssuspend -r python.exe` afterwards (the process is stopped by the watchdog anyway).
- [ ] **Known, not yet fixed (Phase 1.5):** in the cases above, any blur that was active is removed
      (fail-open). This is expected right now and is tracked by the `todo` test.

## 6. Multiple displays (fix #7) — skip if you only have one display

- [ ] With a second monitor connected, start the app. Turn on **Blackout**: **both** displays go dark.
      The control panel appears only on the primary display.
- [ ] Repeat with **Blur**, **Pixelate** (each display shows its own pixelated content),
      **Focus** (the display without the cursor is fully darkened) and **Vignette**.
- [ ] Unplug the second monitor while Blackout is on: no errors, primary still dark.
- [ ] Plug it back in: the second display is dark within ~1 s.
- [ ] Change the second display's resolution or scale (Settings → Display): its overlay
      still covers the whole display edge-to-edge.
- [ ] Change which display is "main display" in Windows settings: the control panel moves to the new
      primary display; both displays are still covered.
- [ ] Enable protection, step away until walk-away blur starts: blur appears on **both** displays.

## 7. Overlay covers the taskbar

- [ ] Turn on **Blackout**: the taskbar is covered too (the overlay now uses full display bounds).

## Results

| Section | Result | Notes |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |

Windows version (`winver`): ______

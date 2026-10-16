# Security notes and known limits

SmartScreen is a local privacy aid, not an access-control system. Windows sign-in remains the
security boundary: SmartScreen may lock the session but never unlocks it or bypasses Windows authentication.

## Recognition
- Owner matching uses the cosine similarity between SFace embeddings and the enrolled template.
  The similarity is a score, not a probability. The threshold (`recognitionThreshold`, default 0.363)
  is OpenCV's published baseline and is not calibrated per device.
- There is no anti-spoofing: a photo or video of the owner on a phone may be accepted as the owner.

## Camera health
- **Read failures:** if the camera stops returning frames for `cameraFailureTimeout` (3 s), the backend
  reports `CAMERA_ERROR`.
- **Blocked or frozen image:** this is a heuristic. Windows can revoke camera access mid-stream, and a
  privacy shutter or covered lens blocks the image; in both cases frames keep arriving. The backend reports
  `CAMERA_ERROR|The camera image is blocked or frozen (...)` when either of these lasts 3 s:
  - consecutive frames are byte-identical on an 80×60 grayscale view (`frozen`); real sensors always add noise;
  - the image is near-black and uniform: mean < 10 and std < 4 on 0–255 (`dark`).

  Limits: an extremely dark room with a very clean sensor can be reported as `dark`. This errs on the
  safe side (camera unavailable). A driver that shows a *changing* placeholder animation would not
  be detected.

## Presence Gate and fail-closed (Phase 1.5)
- While protection is on, the screen is concealed by a privacy curtain (default: full blackout on every
  display) unless the enrolled owner has been verified continuously (≥ 3 consecutive updates and ≥ 1.2 s).
  Unrecognized faces never reveal it.
- **Fail closed:** a camera error, a crash or exit of the recognition service, a watchdog timeout or an
  unknown state puts the gate in FAILSAFE: the curtain stays up until a Retry plus owner verification, or
  a confirmed Disable Protection. This also applies when the Presence Gate toggle is off.
- The tray "Hide Overlay" item is refused while the curtain is up.
- **The curtain is a visibility control, not a security boundary.** It is an always-on-top window.
  Observed on Windows 11 (live check, `docs/testing/phase-1.5-results.md`):
  - covered: desktop, app windows, taskbar, fullscreen browser video;
  - **not covered** (Windows shell surfaces above every app window): Start menu (incl. recommended
    files), Alt+Tab and Win+Tab thumbnails, notification toasts. Except toasts, these need someone at the
    keyboard, which the walk-away and threat locks address;
  - secure desktop (UAC, Ctrl+Alt+Del, lock screen) is drawn by Windows and shows no app content;
  - virtual desktops: Electron cannot show a window on all desktops on Windows. SmartScreen moves its
    overlays to the current desktop within ~1 s of a switch (`IVirtualDesktopManager`), so after a
    switch the other desktop can be visible for up to about a second.
  Windows lock is the security boundary.
- Anyone at the keyboard can disable protection (with a confirmation) or quit the app; SmartScreen
  does not authenticate that person. It never unlocks Windows.

## Pixelate
While pixelate is on, the overlay is excluded from screen capture (so it can capture the screen
underneath), which means screen sharing shows the raw screen during that time.

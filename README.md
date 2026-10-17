# SmartScreen Privacy Suite

Local-first privacy protection for Windows 10/11. SmartScreen recognizes the enrolled owner
through the webcam, notices when someone else may be looking at the screen, and responds with a
privacy curtain, blur or pixelation, or by locking the Windows session. It runs CPU-only and
offline: no cloud services, no network requests.

## Features
- Owner recognition with OpenCV YuNet (detection) and SFace (recognition); up to 10 trusted people
- Identity states: owner present, unknown person, unknown group, owner with an onlooker, nobody,
  camera error, AI unavailable. Anything uncertain is treated as "not the owner" (fail closed)
- One Privacy Intensity slider sets every effect's strength
- Escalation, walk-away lock and grace timers; profiles (built-in and custom, auto-switch by Wi-Fi)
- Event history explaining every protection decision (`activity.log`)
- Optional security images of unrecognized people, off by default and encrypted (`safeStorage`)
- Enterprise policy file, settings export/import (no faces), diagnostics

SmartScreen may lock Windows; it never unlocks it and never bypasses Windows sign-in.
Limits are documented honestly in [docs/SECURITY.md](docs/SECURITY.md).

## Install
Download `SmartScreen Privacy Suite Setup 1.0.0.exe` from the GitHub Release and run it. The
installer is not code-signed, so Windows may show a warning first. On first start, enroll your face
(five samples), then turn protection on from the tray or the control panel.

## Develop
Requirements: Windows 10/11 64-bit, Node.js, Python 3.10+, a webcam.

```powershell
python -m pip install -r backend\requirements-phase1b.txt
python -m pip install -r backend\requirements-dev.txt
powershell -ExecutionPolicy Bypass -File .\models\download_face_models.ps1   # if models/ is empty
npm install
npm start
```

Tests:

```powershell
npm test                          # Node unit tests
python -m pytest backend/tests    # Python unit tests
node scripts/runtime_health.js    # dependency check
npm run test:e2e                  # Playwright on the real app (test mode; the screen flickers)
```

Build the installer (PyInstaller AI service + electron-builder NSIS, output in `dist/`):

```powershell
python -m pip install pyinstaller
npm run build
```

## Architecture
- `backend/face_detection.py` — vision loop (YuNet + SFace), line protocol on stdout
- `backend/enroll_face.py` — owner template from 5 samples
- `backend/smartscreen_ai.py` — single entry point of the packaged AI service
- `electron/main.js` — lifecycle, AI process and watchdog, protection timers, Windows locking, tray
- `frontend/` — transparent overlay and the compact control panel
- `config/settings.json` — tunable delays and thresholds

## Privacy
Camera frames are processed in memory on the device. Temporary enrollment images are deleted after
processing. Face templates and security images are encrypted with Electron `safeStorage`
(Windows DPAPI) under `%APPDATA%\smartscreen-privacy-suite`.

## License
MIT, see [LICENSE](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)
and [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

# Dependencies

Every package or model SmartScreen uses, with its license and whether it ships.
All runtime pieces run CPU-only and offline.

| Dependency | Version | License | Used for | Ships? |
|---|---|---|---|---|
| Electron | 44.5.1 (exact) | MIT | App shell / runtime (upgraded from 28 in Phase 5: Electron ≤ 41.10.5 has high-severity advisories) | yes |
| electron-builder | 26.17.0 (exact) | MIT | Installer build. Build-time advisory: sprintf-js (moderate) via global-agent; not shipped | no (build) |
| opencv-contrib-python | >=4.10 | Apache-2.0 | Camera, YuNet/SFace runtime | yes |
| numpy | >=1.26 | BSD-3-Clause | Embedding math | yes |
| YuNet `face_detection_yunet_2023mar.onnx` | 2023mar | MIT (OpenCV Zoo) | Face detection | yes |
| SFace `face_recognition_sface_2021dec.onnx` | 2021dec | Apache-2.0 (OpenCV Zoo) | Face recognition | yes |
| koffi | ^3.3.3 | MIT | FFI to Windows `IVirtualDesktopManager` (overlay follows the current virtual desktop) | yes |
| Python runtime | 3.11 | PSF License | Bundled into the AI service by PyInstaller | yes |
| PyInstaller | 6.19.0 | GPL-2.0 with bootloader exception | Builds `smartscreen_ai.exe` (monitor + enroll); the exception allows shipping the bootloader with any-licensed code | yes (bootloader) |
| NSIS (via electron-builder) | bundled | zlib | Windows installer | yes (installer stub) |
| pytest | >=8 | MIT | Python unit tests | no (dev) |
| @playwright/test | 1.64.1 | Apache-2.0 | End-to-end tests of the real app (`npm run test:e2e`) | no (dev) |

Playwright drives Electron directly (`_electron`); no browser download is needed.
Test fixtures are recorded locally and never committed (see `docs/testing/self-test-harness.md`).

## Shipping notes
- The installer contains: the Electron app (`electron/`, `frontend/`, default `config/settings.json`
  and `config/policies.json`), `resources/backend/smartscreen_ai/` (PyInstaller one-folder build),
  `resources/models/*.onnx`, `resources/assets/` icons, `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`.
  The allow-list lives in `package.json` → `build.files` / `extraResources`.
- OpenCV's FFmpeg plugin DLL (`opencv_videoio_ffmpeg*.dll`, LGPL) is removed from the AI build;
  the webcam uses Media Foundation / DirectShow. Without it the AI service cannot read video files,
  which only the dev self-test harness needs.
- `THIRD_PARTY_NOTICES.txt` is generated from the installed license files:
  `python scripts/third_party_notices.py`. Rerun it when a shipped dependency changes.
- Electron ships Chromium's notices as `LICENSES.chromium.html` next to the executable.

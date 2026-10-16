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
| pytest | >=8 | MIT | Python unit tests | no (dev) |
| @playwright/test | 1.64.1 | Apache-2.0 | End-to-end tests of the real app (`npm run test:e2e`) | no (dev) |

Playwright drives Electron directly (`_electron`); no browser download is needed.
Test fixtures are recorded locally and never committed (see `docs/testing/self-test-harness.md`).

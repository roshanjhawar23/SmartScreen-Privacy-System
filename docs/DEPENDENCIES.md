# Dependencies

Every package or model SmartScreen uses, with its license and whether it ships.
All runtime pieces run CPU-only and offline.

| Dependency | Version | License | Used for | Ships? |
|---|---|---|---|---|
| Electron | ^28 | MIT | App shell | yes |
| electron-builder | ^24 | MIT | Installer build | no (build) |
| opencv-contrib-python | >=4.10 | Apache-2.0 | Camera, YuNet/SFace runtime | yes |
| numpy | >=1.26 | BSD-3-Clause | Embedding math | yes |
| YuNet `face_detection_yunet_2023mar.onnx` | 2023mar | MIT (OpenCV Zoo) | Face detection | yes |
| SFace `face_recognition_sface_2021dec.onnx` | 2021dec | Apache-2.0 (OpenCV Zoo) | Face recognition | yes |
| koffi | ^3.3.3 | MIT | FFI to Windows `IVirtualDesktopManager` (overlay follows the current virtual desktop) | yes |
| pytest | >=8 | MIT | Python unit tests | no (dev) |
| @playwright/test | 1.64.1 | Apache-2.0 | End-to-end tests of the real app (`npm run test:e2e`) | no (dev) |

Playwright drives Electron directly (`_electron`); no browser download is needed.
Test fixtures are recorded locally and never committed (see `docs/testing/self-test-harness.md`).

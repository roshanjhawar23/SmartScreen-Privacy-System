# Plan — self-test harness (Step A)

Goal: test the real app without the owner present, so each phase can be verified end to end.

## Build
1. `backend/camera_source.py` + `face_detection.py`: `cameraSource` (webcam | video | image folder),
   honoured only with `SMARTSCREEN_TEST=1`; end of file → `CAMERA_ERROR` through the existing `CameraHealth` path.
2. `electron/screen_lock.js`: pure locker; test mode logs `TEST_LOCK_SIMULATED` instead of locking.
   `main.js` uses it, plus test-only userData / camera source / settings overrides.
3. `tests/fixtures/tools/`: webcam recorder, synthetic empty clip, scenario builder (OpenCV, no ffmpeg),
   owner template via the real `enroll_face.py`. Output in `tests/fixtures/private/` (gitignored).
4. `tests/e2e/` Playwright `_electron` specs, `npm run test:e2e`.

## Test cases
- Unit (py): source gating by env, pacing, frame drop, end-of-source, missing source, monitor → CameraError on video end.
- Unit (js): real mode runs `LockWorkStation`; only `SMARTSCREEN_TEST=1` simulates; error logging.
- e2e: empty room → walk-away → simulated lock → camera error; missing source; owner verified;
  camera stop; walk-away return/lock; unknown threat lock; owner+unknown; threat recovery;
  fail-closed after camera error (expected failure until Phase 1.5).

## Revision (owner decision, 2026-10-16)
No webcam fixtures before Phase 5. Added a scripted mock backend (`SMARTSCREEN_MOCK_BACKEND`) used by all
protection e2e tests; video face-recognition tests are pending ("needs owner fixture").

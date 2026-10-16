# Self-test harness

Runs the real app (Electron + Python vision loop) against recorded camera input,
with the Windows lock simulated, and asserts on the UI, overlay layers and `activity.log`.

## Test mode (`SMARTSCREEN_TEST=1`)

Everything below is ignored unless `SMARTSCREEN_TEST=1` is set. Real mode is unchanged.

| Variable | Effect in test mode |
|---|---|
| `SMARTSCREEN_USER_DATA` | Isolated userData folder (profile, encrypted template, logs). |
| `SMARTSCREEN_CAMERA_SOURCE` | Video file or image folder used instead of the webcam (`cameraSource` config). |
| `SMARTSCREEN_TEST_SETTINGS` | JSON merged over `config/settings.json`. |

- **Camera source** (`backend/camera_source.py`): frames are delivered at real-time pace
  (late frames dropped, like a live camera). When the file ends every read fails, so the
  backend reports `AI_ERROR|CAMERA_ERROR|...` exactly as for a camera that stopped.
  The backend checks `SMARTSCREEN_TEST` itself as well, so a stray config value cannot
  replace the webcam in real mode (`backend/tests/test_camera_source.py`).
- **Lock** (`electron/screen_lock.js`): logs `LOCK_REQUESTED|reason=...` then
  `TEST_LOCK_SIMULATED|reason=...` and runs nothing. In real mode it runs
  `LockWorkStation` as before (`tests/screen_lock.test.js` proves both).

## Private fixtures (`tests/fixtures/private/`, gitignored, never commit)

| File | How |
|---|---|
| `owner.mp4` | `python tests/fixtures/tools/record_webcam.py owner --seconds 15` (sit in front, turn head a little) |
| `owner_away.mp4` | `python tests/fixtures/tools/record_webcam.py owner_away --seconds 10` (turn fully sideways) |
| `unknown.mp4` | Provided by the owner: a consenting other person, or the owner in a disguise. Never internet faces. |
| `empty.mp4` | `python tests/fixtures/tools/make_empty.py` (synthetic) or `record_webcam.py empty` while away |
| `owner_template.json` | `python tests/fixtures/tools/make_template.py` (real `enroll_face.py` on 5 frames of owner.mp4) |
| `scenarios/*.mp4` | `python tests/fixtures/tools/build_scenarios.py` |

Scenarios: `empty_only`, `owner_then_stop`, `walkaway_return` (owner 6 s → empty 4 s → owner),
`walkaway_lock` (owner → empty 16 s), `threat_lock` (owner → unknown 12 s),
`threat_recovery` (owner → unknown 2.5 s → owner), `owner_and_unknown` (side by side),
`owner_away` (owner → turned away → owner, for Phase 2).

## Running

```
npm test                        # Node unit tests
python -m pytest backend/tests  # Python unit tests
npm run test:e2e                # Playwright + Electron, real app in test mode
```

e2e notes:
- Fullscreen always-on-top overlays appear while a scenario runs (about 20 s each). Don't type meanwhile.
- A scenario whose fixtures are missing is **skipped** with the missing file named. Skipped ≠ passed:
  a phase is not tagged while any scenario it relies on is skipped.
- Screenshots: `tests/e2e/artifacts/*.png` (gitignored). The window is transparent, so the desktop
  behind it is not in the screenshot; layer state is asserted from the DOM.
- `test.fail()` marks a known defect (currently: fail-open on camera error, fixed in Phase 1.5).
  It reports as passed while the defect exists and turns red once fixed, so the marker must be removed.

## What the harness cannot prove

Real webcam behaviour (lighting, autofocus, driver unplug), a real Windows lock, overlay coverage
of the Start menu / Alt+Tab / fullscreen video, and multi-monitor layouts. These stay in each
phase's live check (`docs/testing/<phase>-results.md`).

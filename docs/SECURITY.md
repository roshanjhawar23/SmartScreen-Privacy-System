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

## Fail-closed (known defect until Phase 1.5)
A monitoring failure (camera error, backend crash, watchdog timeout) currently removes automatic
protection effects, which reveals the screen. The Phase 1.5 Presence Gate fixes this. It is tracked by a
`todo` unit test and by expected-failure e2e tests (`FAIL-CLOSED ...` in `tests/e2e/protection.spec.js`).

## Pixelate
While pixelate is on, the overlay is excluded from screen capture (so it can capture the screen
underneath), which means screen sharing shows the raw screen during that time.

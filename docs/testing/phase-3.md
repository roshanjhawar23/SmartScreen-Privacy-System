# Phase 3 — live check (batched with Phase 2)

Automated coverage: `backend/tests/test_liveness.py`, `test_face_tracker.py` (identity smoothing,
re-identification), `tests/threat_score.test.js`, `tests/tamper_diagnostics.test.js`,
`tests/e2e/security.spec.js` (liveness gate, every tamper kind, diagnostics export).

## Live steps (real webcam)
1. Sit down and enable protection: revealed after you move your head or blink (liveness LIVE).
2. Sit very still right after enabling: note how long until revealed (liveness UNKNOWN while still).
3. Show a photo of yourself on a phone, held still in front of the camera (you out of view):
   the screen must stay concealed.
4. Cover the camera with a finger: `TAMPER|camera-covered`, "Camera unavailable — screen protected".
5. While protected, edit `config/settings.json` (add a space, save): `TAMPER|config-modified`, FAILSAFE.
   Undo the edit, then Retry.
6. Open Diagnostics: fps, recognition ms and CPU are plausible on this laptop; Export writes a file
   with no window titles or images.
7. Two people (optional, consenting): identities do not flicker in the panel.

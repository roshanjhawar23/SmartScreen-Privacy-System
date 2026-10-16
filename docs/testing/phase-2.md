# Phase 2 — live check (Intelligent Privacy)

Automated coverage: `backend/tests/test_head_pose.py` (synthetic 3D face, yaw/pitch/roll grid),
`test_face_tracker.py`, `tests/policy_engine.test.js` (scenario table), `tests/e2e/policy.spec.js`
(mock backend with face tracks; simulated foreground app). The live check covers the real webcam
pose estimate and real foreground applications.

## A. Head pose on the real webcam (owner only)
1. Face the screen: log/panel shows `facing=FACING_SCREEN`, |yaw| < 20°.
2. Turn the head ~30° left, then right: `GLANCING`, yaw sign flips.
3. Turn ~60° or more: `AWAY` (or no face).
4. Look down at the keyboard: pitch rises; note the neutral pitch to calibrate `headPose.pitchOffset`.

## B. Foreground apps
5. Open Outlook (or Gmail in a browser): `SENSITIVE_APP_ACTIVE|category=Email`.
6. Open a bank site: `category=Banking`. Switch to Notepad: `SENSITIVE_APP_INACTIVE`.
7. Confirm no window title text appears in `activity.log`.

## C. Profiles
8. Panel dropdown and tray → Privacy profile: both switch, and stay in sync.
9. Home profile: curtain is blur; Office/Public: blackout.
10. Restart the app: the chosen profile is kept.

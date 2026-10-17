# Phase 5 live check (installed build, v1.0.0)

Installer: `dist/SmartScreen Privacy Suite Setup 1.0.0.exe`. Same Windows account as development:
the installed app uses the same user data (`%APPDATA%\smartscreen-privacy-suite`), so the existing
enrollment, trusted people and profiles carry over. Results go in `phase-5-results.md`.

## A. Installed-build smoke (~10 min)
1. Quit the dev app from the tray. Run the installer (per-user; the default directory is fine).
2. Start SmartScreen from the Start menu. Expect: tray icon; no Python window; within ~10 s the
   log shows `AI_READY` from the packaged service.
3. Turn protection on while sitting in front of the camera → `OWNER_PRESENT`, screen visible
   (move your head slightly if it stays hidden: liveness).
4. Cover the camera / look away → privacy effect, then curtain per the escalation timers.
5. Unknown face (a photo on your phone held up next to you) → `OWNER_AND_UNKNOWN`, effect applied.
6. Walk away from the desk → Windows locks after the walk-away delay. Sign in with Windows as usual.
7. Enrollment through the packaged AI: protection off → Manage → add a trusted person "Test" (yourself,
   5 samples) → saved. Then delete "Test".
8. Diagnostics shows app version 1.0.0 and Electron 44.5.1.

## B. Security images (~5 min)
1. First start of the installed app migrates `intruder_logs/`: log `EVIDENCE_MIGRATED|encrypted=30|plaintextDeleted=38`
   and the folder no longer holds JPEGs.
2. Diagnostics → "Save images" on → the one-time notice appears → accept. Log `EVIDENCE_SETTING|enabled=true`.
3. Protection on, hold the phone photo up while you are out of view → `PHOTO_SAVED`; `evidence/` holds an
   `.enc` file that does not open as an image.
4. Diagnostics → View images → the photo shows; delete it.
5. Owner-confirmed discard: step into view right after an unknown event → `PHOTO_DISCARDED|…owner-confirmed`.
6. Turn "Save images" off again (or leave it, your choice).

## C. Desktop follow (~3 min)
1. Protection on, curtain showing (cover the camera).
2. Win+Ctrl+→ to another virtual desktop and back, three times. Expect: the curtain is on every desktop;
   at most a brief flash (≤ 250 ms) of the desktop underneath. Log `OVERLAY_DESKTOP_FOLLOW|moved=true`.

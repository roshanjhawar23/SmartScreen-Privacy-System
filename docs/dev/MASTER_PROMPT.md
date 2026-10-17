You are working in my SmartScreen Privacy Suite repository on my Windows PC. Read
`CLAUDE.md` first and follow it for the whole session. Your job is to finish the
project through Phase 5. You'll work phase by phase, and you'll first fix any
remaining errors in what has already been built.

# How to run this job

- Work strictly in the order below: Phase 0 → 1 → 1.5 → 2 → 3 → 4 → 5.
- At the start of each phase, write a short plan (files to touch, new modules, tests),
  then implement it.
- At the end of each phase:
  1. Run `npm test` and the Python tests. Fix failures until they all pass.
  2. Launch the app with `npm start` and check that there are no runtime errors in the
     terminal or DevTools console.
  3. Write `docs/testing/<phase>.md`: a manual checklist for the parts that need the
     webcam, the overlay or Windows locking.
  4. Commit.
  5. **Stop and ask me to run the checklist.** Wait for my results. Fix what fails.
     Tag `phase-<n>-complete` only after I confirm, then continue.
- If a requirement is impossible or unsafe to do properly on a CPU-only Windows laptop,
  don't fake it. Implement the honest version, label it clearly, and write the
  limitation into `docs/SECURITY.md`.
- Use the existing state engine and recognition pipeline everywhere. Don't create a
  second face pipeline, a second timer system, or a replacement app.

---

# Phase 0: Audit and fix what exists

Read every file in `electron/`, `frontend/` (ignore `*.backup*`), `backend/`, `tests/`,
`scripts/`, `config/`, and `package.json`. Then fix all of the following and anything
else you find. First check whether each fix is already present: some may already be in
the latest commit "Phase 1 stabilization…".

Known issues to verify and fix:
1. `readSecurityEvents` "is not defined" error: it was nested inside `writeLog` in
   `electron/main.js`. It must be a top-level module (`electron/security_events.js`) with tests.
2. Renderer startup code (event refresh, slider init, `setInterval`) was trapped inside
   the `onBiometricUpdated` callback. It must run at startup exactly once.
3. Universal Privacy Intensity: one slider (0–100) drives blur radius, pixel block size,
   blackout opacity, focus darkness, dim and vignette (`frontend/intensity.js`).
   Dragging the slider must not move the panel, and must not be cut off when the
   pointer leaves the panel.
4. Pixelate must actually obscure content. It needs a low-resolution screen capture
   scaled up with nearest-neighbour, with the overlay excluded from capture, and an
   opaque cover before the first frame and on any capture failure. A grid drawn over
   the screen doesn't count.
5. Backend: a camera that stops delivering frames must emit
   `AI_ERROR|CAMERA_ERROR|...`. The heartbeat must stop when the vision loop is stuck,
   so the Electron watchdog fires.
6. **Fail-open on failure:** today, an AI failure, watchdog timeout or camera error calls
   `cancelProtectionSequence` / `clearAutomaticProtection`, which reveals the screen.
   Fix this as part of Phase 1.5 (below), but write a failing test for it now.
7. **The overlay only covers the primary display** (`fullscreen:true` on one
   `BrowserWindow`). Content on other monitors stays exposed. Make protection cover every
   display (one overlay window per display from `screen.getAllDisplays()`, kept in sync
   on `display-added` / `display-removed` / `display-metrics-changed`). Only the primary
   window shows the control panel.
8. `package.json` → `build.files` is `"**/*"`, which would package `Intruder_Logs/`,
   backups, tests and user config into the installer. Fix this in Phase 5 with an explicit
   allow-list, but note it now.
9. **Git history contains intruder face images.** Commit `474696b` added
   `Intruder_Logs/*.png`. `907da86` removed them, but they're still in history and on
   GitHub. Don't rewrite history yourself. In Phase 5, give me exact
   `git filter-repo` steps plus a force-push warning, and ask me before doing anything.
10. `.gitignore` covers `Intruder_Logs/` but the backend default log dir also creates
    `intruder_logs` under userData. Make sure no runtime path inside the repo can be committed.
11. Remove nothing the user relies on, but list the `frontend/*.backup*` files and ask
    whether to delete them.

Add `backend/tests/` with pytest tests for the pure Python logic. Refactor the state and
streak logic out of `main()` into a testable function or class if needed. Run the real
YuNet/SFace models on a fake camera, as a smoke test only.

Deliverable: a short list of every defect found and how each was fixed.

---

# Phase 1.5: Presence Gate

Goal: the screen's visibility depends on reliable recognition of the enrolled owner.

Build it as a new pure module, `electron/presence_gate.js` (a state machine with no Electron
imports and an injectable clock, fully unit-tested). Wire it into `main.js` on top of the
existing state stream.

Gate states: `DISABLED, CONCEALED, VERIFYING, REVEALED, ABSENCE_GRACE, FAILSAFE`.

Rules (each one gets a unit test):
1. When protection is enabled with the gate on, start in `CONCEALED`. The curtain is up
   before the camera even starts.
2. Reveal only after the owner is verified continuously. Require
   `presenceGate.revealConfirmMs` (default 1200 ms) **and**
   `presenceGate.revealConfirmUpdates` (default 3) consecutive `OWNER_PRESENT` updates with
   ownerScore ≥ threshold. Any non-owner update resets the count. The backend must therefore
   emit periodic `OWNER_PRESENT` updates while the owner stays present (for example a
   throttled `STATE` every ~400 ms), not only on change. Keep change-only logging so the log
   doesn't flood.
3. `UNKNOWN_PERSON`, `UNKNOWN_GROUP` and `OWNER_AND_UNKNOWN` never reveal. If one occurs
   while revealed, conceal immediately. The existing threat escalation (blur → focus → lock)
   still runs.
4. When the owner disappears (`NO_USER`), enter `ABSENCE_GRACE`
   (`presenceGate.absenceGraceMs`, default 1500 ms) to absorb detection flicker, then
   conceal. The walk-away lock timer still runs independently.
5. `CAMERA_ERROR`, `AI_UNAVAILABLE`, watchdog timeout, an unknown state, or backend exit
   → `FAILSAFE`: conceal immediately and keep it concealed. Show a clear status
   ("Camera unavailable — screen protected"). Offer **Retry**. Leaving FAILSAFE requires
   either successful owner verification after a retry, or disabling protection through the
   existing confirmation dialog. Optional setting `presenceGate.failsafeLockMs`
   (default off): lock Windows if FAILSAFE lasts that long.
6. Disabling protection or quitting the app is the only manual way to remove the curtain.
   SmartScreen must not close itself while concealed, and monitoring keeps running.
7. Never call anything that unlocks or authenticates Windows. After a Windows lock, the gate
   resets to `CONCEALED` on session unlock (`powerMonitor` `unlock-screen`). It reveals again
   only after owner verification.
8. Curtain = the configured effect (`presenceGate.curtainEffect`: `blackout` default |
   `blur` | `pixelate`) at full intensity, on **all displays**. The control panel stays usable.
9. Every transition is logged as `PRESENCE_GATE|<EVENT>|reason=...` and shown in the event
   history ("Screen revealed for owner", "Screen concealed — owner absent", and so on).
10. UI: a "Presence Gate" toggle in the main panel (compact, same style) and a status line.
    Hide the tray tooltip state when concealed.

Coverage testing (the manual checklist must cover these): Start menu, Alt+Tab, Win+Tab
task view, notifications/toasts, fullscreen video, a fullscreen game or exclusive-fullscreen
app, UAC prompt, Ctrl+Alt+Del, a second monitor, display sleep/wake, sleep/hibernate resume,
and RDP. Record which ones the overlay really covers. Document the uncovered ones honestly
in `docs/SECURITY.md`: the privacy curtain is a visibility control, not a security boundary.
Windows lock is the security boundary.

---

# Phase 2: Intelligent Privacy

1. **Head pose / screen-facing:** use the 5 YuNet landmarks (eyes, nose tip, mouth corners)
   to estimate yaw and pitch (`cv2.solvePnP` with a generic 3D face model, or a calibrated 2D
   ratio method). Classify each face as `FACING_SCREEN`, `GLANCING` or `AWAY`, and emit it per
   face in the STATE message (`facing=`, `yaw=`, `pitch=`). Make the thresholds configurable
   and unit-test the math with synthetic landmarks.
2. **Exposure duration:** track how long each unknown face has been facing the screen
   (simple IoU face tracker, step 1 of Phase 3 tracking can start here). An unknown face that
   is `AWAY` (for example someone walking past, side-on) shouldn't escalate as fast as one
   facing the screen. Express this as policy, not hardcoded values.
3. **Sensitive-application awareness:** detect the foreground window's process name and
   title (Windows API via a small, maintained, MIT-licensed npm package such as `get-windows`,
   or PowerShell as a fallback). Poll at most every 1 s, and only while protection is active.
4. **Per-app policies + privacy profiles:** `config/policies.json` with profiles `Home`,
   `Office`, `Public` (and custom), each with escalation delays, curtain effect, which apps are
   sensitive (password managers, banking in a browser title, email, and so on), and whether
   glancing counts. Switch profiles from the panel (a compact dropdown) and the tray.
5. **Explainable decisions:** a pure `electron/policy_engine.js` takes (identity state,
   faces with pose and exposure, active app, profile) and returns
   `{action, reason, factors[]}`. Every automatic action is logged and shown with its reason,
   for example "Blurred: unknown person facing screen for 2.1 s while Outlook is active
   (Office profile)". Unit-test the engine with a table of scenarios.

---

# Phase 3: Advanced Security

1. **Multi-person tracking:** an IoU and embedding tracker with stable track IDs, so the same
   person isn't re-counted and owner vs. unknown identity doesn't flicker frame to frame.
2. **Liveness (heuristic, honestly labeled):** combine several cheap CPU signals: natural
   micro-motion of landmarks across frames, blink detection (if the 5 YuNet landmarks aren't
   enough, add an eye-region approach or a small CPU face-landmark model, and record its license
   in DEPENDENCIES.md), a screen/print texture check (frequency/moiré), and a frozen-frame
   detector. Require liveness before the Presence Gate reveals (configurable). Document that this
   stops printed photos and frozen images but **does not** reliably stop replayed video or
   masks with an RGB webcam.
3. **Threat scoring:** a pure `threat_score` (0–100) built from unknown-face count, facing,
   exposure duration, distance (face size), liveness, active-app sensitivity and the profile.
   The policy engine maps score bands to blur/focus/curtain/lock. Make it explainable.
4. **Anomaly and tamper detection:** camera covered (very low variance or brightness), camera
   blocked or swapped (device change), frozen feed, AI process killed or repeatedly restarting,
   `settings.json` or policies edited while running (verify with an HMAC whose key is stored
   via `safeStorage`), system clock jumps. Each is its own event. Tamper goes to FAILSAFE.
5. **Local telemetry only:** counters and latency stats (frame time, recognition time, CPU) in
   a local diagnostics view and log. Nothing leaves the device. Add a "Diagnostics" section
   with export to a local file.

---

# Phase 4: Productization

1. **Multiple trusted users:** store templates as a list (each encrypted with
   `safeStorage`, with a name, created date and sample count). Enroll, rename and remove users
   from a compact "Trusted people" panel. Any trusted user counts as "owner" for reveal; an
   unknown person is still a threat. Migrate the existing single template automatically and
   test the migration.
2. **Profiles:** finish the profile system from Phase 2 (create, edit, auto-switch rules, for
   example by Wi-Fi SSID or time of day, if cheap and reliable).
3. **Enterprise policy (scaffold):** a read-only JSON in `%ProgramData%\SmartScreen\policy.json`
   that can lock settings (minimum intensity, mandatory gate, lock delays, disable protection
   off). Show locked settings as locked in the UI. Document it.
4. **Cross-device:** out of scope for a local-first app. Implement only encrypted
   settings/profile export and import (never biometric templates). Write a design note for
   anything more.

---

# Phase 5: Release

1. Package the Python backend with PyInstaller (`face_detection.exe`, `enroll_face.exe`) and
   make dev and packaged paths both work (`enroll_face` is currently dev-only).
2. electron-builder NSIS installer with an explicit `files` allow-list. Exclude:
   `Intruder_Logs`, `*.backup*`, tests, docs, scripts and user config. Models and the backend go
   in `extraResources`. Settings defaults ship read-only, and user overrides live in userData.
3. Run it on a clean Windows VM or user account (no Python and no Node installed). Write the
   checklist and ask me to run it.
4. Dependency and license audit: `npx license-checker --summary`, `pip-licenses`, and the
   model licenses (OpenCV Zoo YuNet/SFace: verify their exact license). Output
   `docs/DEPENDENCIES.md` and `THIRD_PARTY_NOTICES`.
5. Security validation: an IPC surface review (validate every handler's input), CSP on every
   window, `contextIsolation` on, no `nodeIntegration`, no remote content, and checks that
   biometric files are encrypted and logs contain no images or embeddings. Write
   `docs/SECURITY.md` with the threat model and honest limits.
6. Public-GitHub readiness: give me the history-purge steps for the intruder images
   (Phase 0 item 9) and wait for my go-ahead. README with screenshots, an install guide,
   architecture diagram, configuration reference, a demo script, `CHANGELOG.md` and release
   notes. Add a LICENSE only after asking me which one.

---

Start now with Phase 0: read the code, report what you found, then fix it.

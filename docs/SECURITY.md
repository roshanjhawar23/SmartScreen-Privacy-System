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

## Presence Gate and fail-closed (Phase 1.5)
- While protection is on, the screen is concealed by a privacy curtain (default: full blackout on every
  display) unless the enrolled owner has been verified continuously (≥ 3 consecutive updates and ≥ 1.2 s).
  Unrecognized faces never reveal it.
- **Fail closed:** a camera error, a crash or exit of the recognition service, a watchdog timeout or an
  unknown state puts the gate in FAILSAFE: the curtain stays up until a Retry plus owner verification, or
  a confirmed Disable Protection. This also applies when the Presence Gate toggle is off.
- The tray "Hide Overlay" item is refused while the curtain is up.
- **The curtain is a visibility control, not a security boundary.** It is an always-on-top window.
  Observed on Windows 11 (live check, `docs/testing/phase-1.5-results.md`):
  - covered: desktop, app windows, taskbar, fullscreen browser video;
  - **not covered** (Windows shell surfaces above every app window): Start menu (incl. recommended
    files), Alt+Tab and Win+Tab thumbnails, notification toasts. Except toasts, these need someone at the
    keyboard, which the walk-away and threat locks address;
  - secure desktop (UAC, Ctrl+Alt+Del, lock screen) is drawn by Windows and shows no app content;
  - virtual desktops: Electron cannot show a window on all desktops on Windows. SmartScreen moves its
    overlays to the current desktop shortly after a switch (`IVirtualDesktopManager`, checked every
    250 ms, plus a ~150 ms probe), so the other desktop can be visible for up to about 0.4 s
    (measured: up to 0.94 s with the earlier 1 s check).
  Windows lock is the security boundary.
- Anyone at the keyboard can disable protection (with a confirmation) or quit the app; SmartScreen
  does not authenticate that person. It never unlocks Windows.

## Intelligent privacy (Phase 2)
- **Head pose is an estimate.** Yaw and pitch come from 5 detector landmarks on a generic face model
  (`backend/head_pose.py`), accurate to a few degrees on synthetic data and less on real faces
  (glasses, hair, low light, unusual camera placement). `FACING_SCREEN` / `GLANCING` / `AWAY` are
  thresholds on that estimate, configurable in `settings.json → headPose` (`pitchOffset` for a camera
  above or below the screen). A face turned beyond ~60–70° is usually not detected at all and then
  counts as no person.
- **Exposure** is measured per face track (IoU tracker). Two people crossing can swap or restart
  tracks, which restarts their exposure time; Phase 3 adds embedding-based tracking.
- **Policies are not a guarantee of escalation order.** The Presence Gate still conceals immediately
  for any unrecognized face; profiles only change how fast blur, focus and lock follow.
- **Foreground-app awareness** reads the foreground window's process name and title once per second,
  only while protection is on. Titles are matched against keywords in memory and are **never written
  to the log**; the log only records the category and app name (for example "Email / Outlook").
  Keyword matching is heuristic: a browser tab whose title mentions "bank" counts as Banking, and a
  sensitive page whose title has no keyword is not recognised.

## Advanced security (Phase 3)
### Liveness — a heuristic, not anti-spoofing
`backend/liveness.py` collects weak evidence per face track: LIVE needs a blink (eye regions briefly
brighten and recover) or head movement beyond 6° of yaw/pitch; SUSPECT on a frozen face crop. A
screen-moiré cue exists but is **off by default** (`liveness.moireEnabled`): in the live check it
flagged the owner's real face on this laptop's webcam within 0.8 s. Every liveness change is logged
with its reason (`LIVENESS|track=…|state=…|reason=…`). With `presenceGate.requireLiveness` (default on) the owner must
be LIVE before the screen is revealed; missing liveness data counts as not verified.
- **Stops:** a printed or phone photo held still or on a stand, frozen images, static virtual-camera feeds.
- **Does not stop:** a hand-held photo that is tilted (it produces head-movement), a replayed video
  shown on a phone or monitor (moiré is off), a 3D mask.
- Landmark jitter limits all of this: thresholds sit above the jitter measured on synthetic data, so a
  very still real person may stay UNKNOWN until they move or blink.

### Identity smoothing
A track is the owner when the median of its last 5 similarities is above the threshold. This removes
per-frame flicker in both directions: one lucky frame does not make a stranger the owner, one bad frame
does not make the owner a stranger. The cost is about 0.3 s of extra latency after identity changes.

### Threat score
`electron/threat_score.js` is an explainable sum of points (people, attention, distance, liveness,
sensitive app) times a profile multiplier. It can only add escalation on top of the exposure-time rules.

### Tamper and anomaly events
| Event | Detection | Effect while protected |
|---|---|---|
| `TAMPER|camera-covered` / `TAMPER|feed-frozen` | near-black uniform or byte-identical frames for 3 s | FAILSAFE (also CAMERA_ERROR) |
| `TAMPER|camera-device-changed` | video input set changes (renderer `devicechange`) | FAILSAFE |
| `TAMPER|ai-restart-loop` | 3 recognition failures in 10 min | FAILSAFE |
| `TAMPER|config-modified` | HMAC-SHA256 of `settings.json` / `policies.json` changes (key stored with `safeStorage`) | FAILSAFE |
| `TAMPER|clock-jump` | wall clock vs. monotonic clock differ by > 5 min (reset across sleep) | FAILSAFE |
| `CLOCK_ADJUSTED` | 30 s – 5 min difference | logged only |
| `CONFIG_CHANGED_SINCE_LAST_RUN` | digest differs from the previous run | logged only |

Limits: anyone with write access to the user profile can delete the stored digests or key (the next
start then only reports "changed since last run"); an administrator can stop the app entirely. These
detect tampering, they do not prevent it. All watchdog and escalation timers use the monotonic clock, so
changing the system clock cannot make the watchdog fire or shorten a lock delay.

### Local telemetry
Counters and performance numbers stay on the device. "Export diagnostics" writes a JSON file to a path
the user chooses; it contains counters, timings and event titles, never images, embeddings, templates
or window titles.

## Productization (Phase 4)
- **Trusted people:** one template per person, each encrypted with `safeStorage` in
  `userData/biometric/trusted/<id>.enc`; the listing never exposes embeddings. Any trusted person
  counts as the owner (best match). Changes are refused while protection is on, so the set of faces that
  can reveal the screen never changes mid-session. Up to 10 people. The single-owner template of earlier
  versions is migrated once, verified by reading it back, then deleted.
- **More trusted people = more chances of a false match.** Every added template is another face an
  impostor could resemble; keep the list short.
- **Profiles and rules:** custom profiles only choose between built-in timings (no free-form numbers), so
  a profile cannot disable escalation entirely. Auto-switch by Wi-Fi name is convenience, not security:
  anyone can create a network with the same name.
- **Enterprise policy:** see `docs/ENTERPRISE.md`; it hardens the defaults but cannot stop a local
  administrator from ending the process or editing the file.
- **Settings transfer:** see `docs/design/cross-device.md` (passphrase encryption, allow-list, no faces).

## Security images (intruder snapshots) — opt-in, encrypted
- **Off by default** (`settings.json → evidence.enabled: false`). The owner turns it on in
  Diagnostics → "Save images". The first time, SmartScreen shows: *"SmartScreen will save small photos
  of unrecognized people. Make sure people around you are aware."* The choice is stored in
  `userData/evidence_state.json` and applies at once, also during a running session (the backend is told
  `EVIDENCE|1` / `EVIDENCE|0`; anything arriving while off is dropped). Taking photos of people may be
  regulated where you live; the owner is responsible for telling people around them.
- **What is captured:** one photo of the scene when an unrecognized face first appears, downscaled to
  320 px wide, JPEG quality 70 (lowered if needed to stay under 40 KB).
- **Never on disk unencrypted:** the Python backend encodes the JPEG in memory and sends it through the
  pipe; the Electron main process encrypts it with `safeStorage` (the same OS-backed encryption as the
  face templates) and writes `userData/evidence/<time>_<run>-<event>.enc`. Images are decrypted only on
  request for the in-app viewer (Diagnostics → View images), shown from memory and dropped when the
  viewer closes. There is no "open folder": the files are unreadable outside SmartScreen.
- **Bounded:** only the newest 30 are kept (`evidence.maxImages`); older ones are deleted on every save.
  The viewer can delete one image or all of them.
- **Never the owner:**
  - each photo belongs to an event (the unknown face tracks that triggered it); if a later recognition
    in the same event confirms one of those tracks as a trusted person (for example the owner walking in
    and being recognized a moment later), the backend reports it and the event's photos are deleted
    (`PHOTO_DISCARDED|…|reason=owner-confirmed`); events close after 60 s;
  - faces already recognized as trusted in the same frame are blacked out before the photo is encoded.
  Limit: if the owner is never recognized during the event (e.g. leaves before recognition succeeds), the
  photo stays; it can be deleted in the viewer.
- **Earlier versions** stored plaintext JPEGs in `userData/intruder_logs/`. On start, the newest 30 are
  encrypted into the new store (each checked by reading it back) and every plaintext snapshot is deleted.
- **Limits of the encryption:** `safeStorage` protects against other Windows accounts and copies of the
  files; anyone signed in to the same Windows account while SmartScreen is unlocked can view them in the app.

## Pixelate
While pixelate is on, the overlay is excluded from screen capture (so it can capture the screen
underneath), which means screen sharing shows the raw screen during that time.

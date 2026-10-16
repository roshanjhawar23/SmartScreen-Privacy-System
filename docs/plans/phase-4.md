# Plan — Phase 4: Productization

## Build
1. **Trusted people** (`electron/trusted_people.js`, pure; crypto + fs injected): one file per person in
   `userData/biometric/trusted/<id>.enc`, each the JSON `{id, name, createdAt, sampleCount, embedding}`
   encrypted with `safeStorage`. List / add / re-enroll / rename / remove (never the last one).
   Automatic migration of the legacy `owner_face.enc` to a person "Owner": read back and verified, then
   the legacy file is removed. The backend receives every template (`templates`), and the best match
   counts as the owner. Changes only while protection is off (no silent identity change mid-session).
   Enrollment window shows whom it enrolls; the name is chosen in the panel.
2. **Profiles** (`electron/profile_store.js`, `electron/profile_rules.js`, pure): custom profiles in
   `userData/profiles.json` next to the read-only built-ins. Compact editor with selects only (no new
   sliders): curtain effect, sensitivity (relaxed / normal / strict = Home / Office / Public timings),
   walk-away lock delay, glancing counts. Save as new, delete custom.
   Auto-switch rules: Wi-Fi SSID (`netsh wlan show interfaces`, every 30 s) and time windows
   (days + from/to). First matching rule wins; a manual choice holds until the context changes.
   SSIDs are not written to the log.
3. **Enterprise policy** (`electron/enterprise_policy.js`, pure): read-only
   `%ProgramData%\SmartScreen\policy.json` (test mode: `SMARTSCREEN_TEST_POLICY_FILE`):
   `minimumIntensity`, `presenceGateRequired`, `allowDisableProtection`, `allowQuit`,
   `allowedProfiles`, `maxWalkAwayLockDelayMs`, `lockProfiles`, `lockTrustedPeople`, `lockImport`.
   Enforced in main (not only the UI); locked controls are shown as locked. `docs/ENTERPRISE.md`.
4. **Settings transfer** (`electron/settings_transfer.js`, pure): passphrase export/import (scrypt +
   AES-256-GCM) of custom profiles, rules, auto-switch, active profile, gate preference and intensity.
   Strict allow-list; templates, logs and images can never be included. Design note
   `docs/design/cross-device.md` for anything beyond this.

## Tests
- Node: trusted store (CRUD, encryption round trip, last-person guard, names, migration + failure modes);
  profile store and presets; rules (SSID, time windows, overnight, precedence, manual hold); enterprise
  policy (validation, clamping, refusals); transfer (round trip, wrong passphrase, tampering,
  allow-list); renderer locked states.
- Python: multiple templates (owner = best match).
- e2e: migration on first start; add / rename / remove person (mock backend, scripted enrollment);
  profile editor + save as new; time rule auto-switch; enterprise policy locks (disable refused,
  intensity floor, gate forced); export → import on a fresh profile.
- Live check: enroll a second trusted person (owner in different lighting/glasses) and verify both
  reveal; Wi-Fi rule on the real network.

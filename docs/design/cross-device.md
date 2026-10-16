# Design note — cross-device

SmartScreen is local-first: no account, no server, no cloud. Phase 4 implements only what fits that:
an encrypted settings file the user moves themselves.

## Implemented: settings export / import
- Contents (allow-list): custom profiles, auto-switch rules, auto-switch on/off, active profile,
  Presence Gate preference, privacy intensity.
- Never included: biometric templates, intruder images, activity logs, window titles, the integrity key.
  The exporter refuses data that looks biometric, and the importer drops anything not allow-listed.
- Encryption: passphrase → scrypt (N=2¹⁵, r=8, p=1) → AES-256-GCM with a random salt and IV; the file
  header is authenticated. `safeStorage` is not used because it is bound to one Windows account.
- Import is refused while protection is on and when the enterprise policy sets `lockImport`.
- Wi-Fi rules travel with their SSID inside the encrypted file; nothing is logged in clear.

## Not implemented (would need explicit decisions)
- **Syncing faces across devices.** Each device must enroll its own trusted people: templates depend on
  the camera, and moving biometric data off the device conflicts with the local-first promise.
- **Automatic sync** (OneDrive folder, LAN peer, cloud service). Each option adds a trust and conflict
  model (who wins on concurrent edits, key distribution) and, for cloud, a service SmartScreen does not
  have. A future version could watch a user-chosen folder for an encrypted bundle with the same format.
- **Central management.** See `docs/ENTERPRISE.md` for the read-only policy scaffold.

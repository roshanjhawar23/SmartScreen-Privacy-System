# Enterprise policy (scaffold)

An administrator can lock SmartScreen settings with a read-only JSON file:

```
%ProgramData%\SmartScreen\policy.json
```

SmartScreen only reads this file (at startup); it never writes it. Grant users read access only.
Unknown keys and invalid values are ignored. A file that is not valid JSON is reported in the log
(`ENTERPRISE_POLICY|managed=true|error=invalid`) and otherwise ignored.

```json
{
  "minimumIntensity": 60,
  "presenceGateRequired": true,
  "allowDisableProtection": false,
  "allowQuit": false,
  "allowedProfiles": ["Office", "Public"],
  "maxWalkAwayLockDelayMs": 6000,
  "lockProfiles": true,
  "lockTrustedPeople": true,
  "lockImport": true
}
```

| Key | Effect | Enforced in |
|---|---|---|
| `minimumIntensity` (0–100) | Privacy intensity floor | main (secondary displays) + renderer (primary display draws its own effects) |
| `presenceGateRequired` | Presence Gate cannot be switched off | main (`set-presence-gate` refused) |
| `allowDisableProtection: false` | "Disable Protection" refused; only Retry leaves FAILSAFE | main (`stop-ai` refused, `ENTERPRISE_REFUSED`) |
| `allowQuit: false` | tray Exit refused while protection is on | main |
| `allowedProfiles` | only these profiles are offered (the first is the default) | main |
| `maxWalkAwayLockDelayMs` | caps every profile's walk-away lock delay | main |
| `lockProfiles` | no creating/editing/deleting profiles or auto-switch rules | main |
| `lockTrustedPeople` | no adding/renaming/re-enrolling/removing trusted people | main |
| `lockImport` | no settings import | main |

Locked controls are shown as locked in the panel ("Managed by your organization").

## Limits (scaffold)
- Not a Group Policy / ADMX integration; no remote management or reporting.
- Windows shutdown and sign-out are never blocked; `allowQuit` only refuses the tray Exit.
  A user with access to Task Manager can end the process; Windows lock remains the security boundary.
- The policy file is read at startup; restart SmartScreen after changing it.
- Test mode reads `SMARTSCREEN_TEST_POLICY_FILE` instead (only with `SMARTSCREEN_TEST=1`).

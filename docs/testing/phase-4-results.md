# Phase 4 — live check results

Date: 2026-10-16/17, 22:31–00:22 local. Windows 11 Home 10.0.26300, HP Wide Vision HD camera.
Evidence: `activity.log`, `profiles.json`, panel screenshots, owner confirmations.

## Automated (final code)
- Unit: `npm test` 163 pass; `pytest` 127 pass.
- e2e: `phase4.spec.js` 10/10 on the final code; full suite before the last two fixes: 68 pass,
  1 intermittent full-run-only failure (passed 6/6 when re-run; logs are now kept on failure).

## Live steps

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Owner still recognised after the migration to Trusted people | ✅ | `BIOMETRIC_MIGRATED|people=1` on the real profile; similarity 0.71; revealed 5.2 s after Enable |
| 2 | Add a second trusted person ("Roshan (glasses)") from Manage | ✅ | enrollment window showed "Enrolling Roshan (glasses)" (owner); `BIOMETRIC_ENROLLED|samples=5|mode=add`; two encrypted files |
| 3 | Glasses recognised; without glasses still recognised | ✅ | similarity 0.85 with glasses; revealed 2.1 s after first sight; no events when glasses removed |
| 4 | Rename | ✅ | `TRUSTED_PERSON_RENAMED`; names never appear in the log (0 matches) |
| 5 | Custom profile "Desk" with blur curtain | ✅ | `PROFILE_SAVED` → `PROFILE_CHANGED|source=panel`; owner confirmed the screen blurred (not black) while away; walk-away cancelled on return |
| 6 | Wi-Fi rule + manual hold + switch on context | ✅ | rule added; manual Office held ≥ 32 s (≥ 1 rule check); after restart `PROFILE_CHANGED|profile=Desk|source=rule-wifi`; SSID 0 times in the log |

## Defects found during the check (fixed)
- **Instant lock when the owner put on glasses** before the glasses template existed: the same face
  track turned "unknown" and carried 85 s of facing time, so the policy locked at once instead of
  blur → focus → lock. Fixed in 86ce0a9 (exposure restarts when a track's identity changes), regression test.
- Stale "Enrolling…" message after enrollment (ff7a399).
- Earlier in the pre-check audit (384dfcd): legacy enrollment path bypassed trusted-people checks; silent
  switch when deleting the active profile; stale enrollment target after cancel.

## Not covered live
Enterprise policy file on a real `%ProgramData%` path (e2e only), settings export/import (e2e only),
remove-person dialog (owner kept both people; e2e covers removal).

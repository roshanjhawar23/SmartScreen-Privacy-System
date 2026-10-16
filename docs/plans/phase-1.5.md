# Plan — Phase 1.5: Presence Gate

The screen is visible only while the enrolled owner is reliably recognized (MASTER_PROMPT Phase 1.5, rules 1–10).

## Build
1. **`electron/presence_gate.js`** (pure, injectable clock/timers). States `DISABLED, CONCEALED, VERIFYING,
   REVEALED, ABSENCE_GRACE, FAILSAFE`. Curtain is up in CONCEALED / VERIFYING / FAILSAFE.
   - `start()` on protection enable: CONCEALED before the backend is spawned.
   - Owner updates (`OWNER_PRESENT`, ownerScore ≥ threshold): CONCEALED → VERIFYING → REVEALED after
     `revealConfirmMs` (1200) **and** `revealConfirmUpdates` (3) consecutive updates; anything else resets.
   - Threat states conceal immediately (escalation keeps running in protection_sequence).
   - `NO_USER` while revealed → ABSENCE_GRACE (`absenceGraceMs` 1500) → CONCEALED.
   - Camera error, AI unavailable, watchdog, unknown state, backend exit → FAILSAFE. Leave only via
     `retry()` + owner verification, or `stop()` (Disable Protection, confirmed). Optional `failsafeLockMs`.
   - Session lock/unlock/resume → CONCEALED (never unlocks Windows).
   - **Fail-closed even with the gate toggle off:** a monitoring failure while protection is active still
     enters FAILSAFE. The toggle only controls hiding the screen while the owner is absent.
2. **Backend:** `StateTracker` re-emits the stable face state every `stateUpdateInterval` (0.4 s) so the gate
   can count updates; `main.js` logs `AI_STATE` only on change.
3. **`protection_sequence.js`:** monitoring failure cancels timers but no longer sends `CLEAR` (flips the
   Phase 0 `todo`). Owner decision 2026-10-16: an owner-only `OWNER_PRESENT` during a THREAT cancels the
   threat lock (`PROTECTION_SEQUENCE_CANCELLED|type=THREAT|reason=owner-returned`).
4. **Curtain rendering:** main sends `presence-curtain {on, effect}` to *every* overlay window directly
   (not via the primary renderer); `overlay_effects.js` draws it at full intensity (`blackout` default |
   `blur` | `pixelate`); the panel stays usable. Content protection follows the pixelate curtain.
5. **main.js:** gate wiring, `retry-protection` / `set-presence-gate` IPC, `powerMonitor` lock/unlock/resume,
   tray "Hide Overlay" refused while concealed, generic tray tooltip while concealed, optional failsafe lock.
6. **UI:** compact "Presence Gate" toggle (changeable only while protection is off), a screen status line,
   a Retry button in FAILSAFE; Disable Protection keeps its confirmation dialog.
7. **Event history:** `PRESENCE_GATE|<EVENT>|reason=...` lines get human titles.
8. **Settings:** `presenceGate` block in `config/settings.json`.

## Tests
- Unit (`tests/presence_gate.test.js`): one test per rule, plus toggle-off fail-closed and the retry path.
- Unit: protection_sequence fail-closed (todo → test), threat cancel on owner recovery.
- Python: periodic updates (interval, no extra snapshots, change detection unaffected).
- e2e (`tests/e2e/presence_gate.spec.js`, mock backend): concealed at start before AI_READY; reveal only
  after N updates + time; never reveals for unknown / owner+unknown; conceal after absence grace; flicker
  within grace stays revealed; FAILSAFE on camera error / crash / watchdog / unknown state; Retry →
  re-verify → reveal; Disable → curtain off; threat recovery cancels the lock; FAIL-CLOSED markers removed.
- Live check: real webcam reveal/conceal timing, real lock + unlock re-conceal, coverage matrix
  (Start, Alt+Tab, Win+Tab, toasts, fullscreen video/game, UAC, Ctrl+Alt+Del, sleep/wake), plus
  the carried-over Phase 0 items.

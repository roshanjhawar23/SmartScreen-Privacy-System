# Phase 4 — live check

Automated coverage: `tests/trusted_people.test.js`, `tests/profiles_phase4.test.js`,
`tests/enterprise_transfer.test.js`, `backend/tests/test_face_path.py` (any trusted person = owner),
`tests/e2e/phase4.spec.js` (migration, rename/remove, protection-on lock, profile editor, time and Wi-Fi
rules, enterprise locks and refusals, export/import).

## Live steps
1. Start the app: the existing owner appears as "Owner" under Manage → Trusted people (migration).
2. Enable protection: still revealed for you.
3. Disable protection. Manage → Add person "Roshan (glasses)" → enroll yourself with glasses
   (or different lighting). Both entries listed; with glasses on, the screen is revealed.
4. Remove the second entry: confirmation dialog; the first cannot be removed.
5. Profile editor: save a custom profile with Curtain = Blur; enable protection and look away: blur curtain.
6. Auto-switch: Use this profile on the current Wi-Fi, turn auto-switch on, switch to another profile,
   reconnect Wi-Fi (or restart the app): the rule's profile becomes active again.

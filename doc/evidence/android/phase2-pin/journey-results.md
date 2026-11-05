# Journey: Phase 2 mobile PIN gate — parent to child with lock

Date: 2026-11-05. Device: emulator-5554 (Pixel_8-class, API 35), debug APK served by
Metro with the resolver-shim fix from this change. Synthetic account
`android-pin2@example.test`, owned fixture `counting.pdf` only; no family data.

## Implemented and verified on device

- **Sign up → consent → profile** ✅: android-pin2 account created through the app,
  both consents granted via the system dialog, FoxOne profile created; upload through
  the document picker produced three drafts ([01–06 screenshots](.)).
- **Review → approve → assign** ✅: player preview rendered the draft, approve flipped
  the record, ASSIGN turned the approved lesson to Assigned/UNASSIGN
  ([07–09 screenshots](.)).
- **Child play entry** ✅: CHILD PLAY lists the assigned lesson first (verified in the
  previous family-flow journey and visible again here).
- **PIN UI present** ✅: SET PARENT PIN opens the form ([10-pin-form.png](10-pin-form.png)),
  the field accepts input, and the gate/copy render.

## Implemented but NOT verified on device — recorded honestly

- **PIN save → gate → wrong-PIN → restart flow** ❌ (blocked, not app-logic-failed):
  text input into the two PIN `TextInput`s did not deliver `onChangeText` events on
  this emulator session. The field accumulates visible characters (secure dots grow,
  and with a temporary plain-text debug field the literal "2468" rendered) while the
  React state stays empty, so SAVE PIN stays disabled. The identical handler pattern
  fires correctly in the same bundle on the sign-in email/password fields and fired
  for the profile nickname, so the component code is consistent with the working
  fields; the failure is specific to the degraded emulator session (ANRs, Gboard
  stylus toolbar interference, dropped characters). Attempts made: `input text`,
  per-key `input keyevent`, on-screen keyboard taps, removing `maxLength`, removing
  `keyboardType`, removing the controlled `value`, pausing the 3-second dashboard
  refresh during form entry, and emulator/Metro restarts. Not attempted: a fresh
  emulator wipe (`avd` recreate) — the current session ran for hours across many
  reinstall/kill cycles and the input layer degraded progressively.
- The server side of this flow is unit-tested (PIN set/verify/lockout/retry bounds in
  `backend/tests/family.test.ts`), and the same gate UI is covered on the site build.

## Environment failures during the session (recorded per journey rules)

- Firebase emulators process died mid-session once ("An unexpected error has
  occurred") leaving an orphaned java process holding port 8080; restart required
  killing the orphan. In-memory emulator data was lost both times the emulators
  restarted, resetting journey accounts.
- Metro dev server instances repeatedly died or resolved the Expo virtual entry
  against the workspace root; fixed persistently by the resolver shim in
  `mobile/metro.config.cjs` (this change) after the pre-existing config was found
  shadowed by a temporary `metro.config.mjs` during debugging (removed).
- `android run` performed a forced delta reinstall that corrupted the install;
  a clean uninstall + full install restored it.

## Remaining verification for this flow

Fresh-emulator run (wipe the AVD or start a clean one), then the full journey in
`mobile/tests/android-pin-flow.journey.xml` end to end: PIN save, child completion,
gate on exit, wrong-PIN message, restart re-arm, and the parent progress card.

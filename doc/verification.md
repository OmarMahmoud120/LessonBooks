# Verification — 2026-11-04

`npm run check` passed after the final code changes. It ran lint/format checks,
strict TypeScript, generated adapter/contract drift checks, eight agent-policy
and adapter tests, 22 unit tests, all three lesson fixtures, the two-book/two-grade
mocked evaluation, backend/site/player builds, eight Playwright tests and three
Firebase emulator tests.

Browser evidence includes English/Arabic RTL, desktop/mobile viewports, axe,
keyboard interactions, offline interaction after initial load, and the exact
bundled mobile player running under its CSP without unsafe-eval. The shared
contracts use generated standalone validators; runtime schema compilation is
backend-only.

The emulator vertical test uses actual Firebase Auth, Firestore and Storage:
an owned digital PDF becomes three private drafts, one revision is approved,
and child deletion removes lesson records and uploaded/generated storage objects.
Unit regressions cover duplicate worker delivery, bounded regeneration,
cross-family access, deletion resurrection and a worker finishing after deletion.

Offline Expo/Metro iOS JavaScript export also passed. This proves JavaScript
bundling, not native iOS execution or screen-reader conformance. Android native
evidence is recorded separately below.

One independent security/privacy review produced actionable findings that were
fixed. Its follow-up hit the account usage limit. Full reviewer/native-agent
coverage is pending and is not inferred from scripted tests.

No paid model calls, real family data, MCP connections, pushes or deployments.
Remaining phase criteria and external decisions are recorded in milestones.md.

## Android safe-area follow-up

The full `npm run check` passed again after the mobile safe-area and explicit
memory-auth change: 8 agent-policy tests, 22 unit tests, 8 browser tests, and
3 Firebase emulator tests, plus lint, types, drift checks, fixtures, mocked
prompt evaluation, and all builds. The host used Node v23.7.0 rather than the
repository's declared >=24; this is not verification on the supported Node engine.

The rebuilt Android debug APK passed the 25-action parent-preview journey on
Pixel_8_35 (emulator-5554), including an owned PDF, native WebView correct-answer
feedback, approval, and child deletion. Safe-area navigation was visually inspected.
See [the native rerun report](android-native-rerun.md) for commands, screenshots,
earlier failures, the dismissed Metro development warning, and remaining UI issues.

Offline iOS JavaScript export passed with react-native-safe-area-context included.
Native iOS, TalkBack, native RTL, release mode, and upload crash cleanup remain
unverified. Native iOS, native screen-reader/RTL checks and remaining reviewer
coverage are scheduled for the [polishing phase](milestones.md#polishing-phase).
All test services were stopped;
no physical-phone interactions, paid AI calls, pushes, or deployments occurred.

## Upload-copy cleanup follow-up

Full npm run check passed with 8 agent-policy, 33 unit, 8 browser and 3 Firebase
emulator tests. Eleven new lifecycle tests cover failure, recovery, serialization
and deletion boundaries. Android seeded-residue recovery and repeated startup
passed with source/sibling checksums preserved; see [the focused report](upload-cache-cleanup.md).
Actual OS-crash timing and native iOS recovery remain unverified. No full native
parent journey was rerun for this change. The existing APK loaded updated JS from
Metro; no new APK build was necessary.

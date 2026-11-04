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

## Phase 2 verticals — 2026-11-05

Lint, types, generated-contract/agent drift checks, fixtures, mocked prompt
evaluation and all builds pass. The test run has 8 agent-policy plus 6 evaluator
tests, 110 unit tests, 8 Playwright tests and 3 Firebase emulator tests. Ten new
unit tests cover the durable event queue (order, 500-event bound, 50-event batches,
failed flush retention, corrupt storage and unavailable storage) and the offline
lesson/summary cache (revision keys, approved-only summaries and malformed entries).

Backend tests cover multi-kid scoping and the four-kid limit, PIN set/verify with
lockout, assignments pinning approved revisions with deletion sweep, and queued
event ingestion with kid ownership, revision mismatch, batch bound and event_id
deduplication. Browser tests are unchanged and do not exercise offline cache
recovery end to end, dashboard rendering or the kid-view event path; those remain
covered only by unit and API tests. No native device, live model, push or deployment
was involved.

`npm run check` itself could not run its emulator wrapper because a user-started
emulator already held ports 8080/9099/9199. The rules suite was run directly against
that emulator instance and passed 3/3; all earlier stages of `npm run check` passed.

## Cloudflare Markdown evaluation — 2026-11-05

The evaluator's six mocked tests pass. A user-run live batch of four synthetic
fixtures returned HTTP 200 for all files: text-bearing PDFs convert but gain heading
noise, the image-only PDF returns no text, and the image request returns an English
description rather than a transcription (letter CER 8.37). The provider was not
adopted for ingestion; details and limits are in
[the evaluation report](cloudflare-markdown-test.md).

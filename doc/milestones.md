# Milestones

Updated: 2026-11-04. Phase 0 and Phase 1 are in progress. The local synthetic-content
vertical slice is implemented; the remaining criteria below prevent a full phase-complete claim.

## Verified implementation

- [x] Git initialized; foundation commit 666e776; four product roots preserved.
- [x] Shared instructions, eight skills, seven roles/workflows and Codex/Claude/OpenCode adapters.
- [x] Eight agent policy/adapter tests; deterministic generated-adapter checks.
- [x] Canonical v1 lesson/event schemas, generated TypeScript and standalone validators.
- [x] Three lesson fixtures, including Arabic RTL; two owned digital PDF fixtures.
- [x] Parent Auth, consent confirmation, one minimal profile, PDF upload, progress, review/approval.
- [x] Six typed stage functions, persisted attempts/leases/fences, duplicate delivery protection.
- [x] Mocked decision-model routing and OpenRouter HTTP adapter with provider allowlists.
- [x] Bounded regeneration: at most two quality-repair transitions, tested with rejected output.
- [x] Private publication, cross-family checks, child deletion and stale-worker deletion tests.
- [x] Minimal account deletion tombstone; pending account deletion resumes in the local worker.
- [x] First five player activities, keyboard controls, feedback, scoring and partial credit.
- [x] Web/mobile share the player; WebView navigation/message boundaries and script-data escaping.
- [x] LTR/RTL axe tests in desktop/mobile viewports and offline interaction after initial load.
- [x] Real emulator test: Auth → owned PDF → three private drafts → approval → data erasure.
- [x] Firestore/Storage rules deny direct private access for anonymous and signed-in clients.
- [x] iOS JavaScript bundle export verified with Metro; this is not native-device execution.
- [x] PDF text extraction runs in a timed worker with a bounded JavaScript heap.

## Remaining Phase 0 evidence

- [ ] Native smoke sessions for every role/command in each supported agent. Claude CLI is absent;
      a second independent review attempt hit the account usage limit. Adapter tests do not replace this.
- [x] Final npm run check passes: 8 agent-policy, 22 unit, 8 browser and 3 emulator tests; see verification.md.
- [ ] Full reviewer coverage (schema, privacy/security, accessibility/RTL and pedagogy), beyond the
      completed independent security/privacy pass and automated component checks.

## Remaining Phase 1 work and external gates

- [ ] Native iOS/Android WebView execution, screen-reader checks and upload crash-residue cleanup.
- [ ] OCR binaries/scanner verified, source image extraction, stronger source-language detection.
- [ ] Cloud Tasks/OIDC/outbox transport and deployable Cloud Run packaging (local polling exists).
- [ ] Approved real model/provider configuration, conservative live spend enforcement and live QA.
- [x] Two-book mocked prompt evaluation across both grades; real-model before/after reports remain pending.
- [ ] Region, retention/tombstone policy, legally sufficient parental consent and vendor processing review.

No live family data, paid AI calls, MCP connections, pushes or deployments have been performed.
The local entrypoint explicitly refuses production/live mode. Mocked validation is not evidence of
real-model safety, source grounding or educational effectiveness.

## Deferred phases

Phase 2: child switching, PIN/gate, assignments, durable offline cache, queued events and dashboard.
Phase 3: additional launch curricula/languages and remaining five activities.
Phase 4: parent editing/regeneration UI and expanded moderation/evaluation quality.
Phase 5: broader markets, game shells and subscriptions.

## Android native attempt — 2026-11-04

Android CLI 1.1.16717390 built and installed the debug APK on Pixel_8_35
(emulator-5554, arm64-v8a). JDK 21 resolved the initial Gradle/JDK 25 mismatch.
Native verification is now attempted, but failed before sign-in: an initial Metro
connection error was followed by a blank screen after reload. Login, PDF upload,
WebView lessons, approval and deletion remain unverified on Android. See
android-native-test.md and evidence/android/. The connected physical phone was
not used. Do not mark the native-device milestone complete.

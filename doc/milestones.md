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
- [x] Docker packaging: multi-stage api/worker/emulator targets, hardened compose stack with
      scanner-definition updater; smoke tests pass (doc/docker.md, ADR 0009).

## Remaining Phase 0 evidence

- [ ] Native smoke sessions for every role/command in each supported agent. Claude CLI is absent;
      a second independent review attempt hit the account usage limit. Adapter tests do not replace this.
- [x] Final npm run check passes: 8 agent-policy, 33 unit, 8 browser and 3 emulator tests; see verification.md.

## Remaining Phase 1 work and external gates

- [x] Native Android emulator journey: signup, consent, profile, owned PDF, WebView answer, approval and child deletion.
- [x] Upload-copy lifecycle cleanup, failure/race tests and Android seeded-residue startup recovery; see upload-cache-cleanup.md.
- [ ] OCR binaries/scanner verified, source image extraction, stronger source-language detection.
- [ ] Cloud Tasks/OIDC/outbox transport and deployable Cloud Run packaging (local polling exists).
- [ ] Approved real model/provider configuration, conservative live spend enforcement and live QA.
- [x] Two-book mocked prompt evaluation across both grades; real-model before/after reports remain pending.
- [ ] Region, retention/tombstone policy, legally sufficient parental consent and vendor processing review.

No live family data, paid AI calls, MCP connections, pushes or deployments have been performed.
The local entrypoint explicitly refuses production/live mode. Mocked validation is not evidence of
real-model safety, source grounding or educational effectiveness.

## Polishing phase

Deferred here by the user on 2026-11-04; these items no longer block ongoing
Phase 0/1 implementation. They remain unverified and are not counted as completed.

- [ ] Native iOS WebView execution, parent-preview journey and upload-cache recovery.
- [ ] Native TalkBack/screen-reader and Arabic RTL checks.
- [ ] Full reviewer coverage (schema, privacy/security, accessibility/RTL and pedagogy), beyond the
      completed independent security/privacy pass and automated component checks.

## Deferred phases

Phase 2: child switching, PIN/gate, assignments, durable offline cache, queued events and dashboard.
Phase 3: additional launch curricula/languages and remaining five activities.
Phase 4: parent editing/regeneration UI and expanded moderation/evaluation quality.
Phase 5: broader markets, game shells and subscriptions.

## Android native attempt — 2026-11-04

Android CLI 1.1.16717390 built and installed the debug APK on Pixel_8_35
(emulator-5554, arm64-v8a). JDK 21 resolved the initial Gradle/JDK 25 mismatch.
The original attempt failed before sign-in: a Metro connection error was followed
by a blank screen after reload (android-native-test.md). A cold launch with Metro
ready restored sign-in. Native testing exposed system-bar overlap, now fixed with
safe-area insets. The rebuilt APK passed all 25 parent-preview journey actions;
see android-native-rerun.md and evidence/android/. The connected physical phone
was not used. Native iOS, TalkBack, RTL, release-mode launch and crash cleanup
were unverified in that journey. Follow-up upload-cache-cleanup.md verifies Android
seeded-residue startup recovery; real crash timing remains unverified. This does
not complete Phase 1.

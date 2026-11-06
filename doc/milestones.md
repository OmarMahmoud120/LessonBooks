# Milestones

Updated: 2026-11-05. Phase 0 and Phase 1 are in progress; Phase 2 is complete for the
local synthetic scope. The local synthetic-content vertical slice is implemented; the
remaining criteria below prevent a full phase-complete claim.

## Verified implementation

- [x] Git initialized; foundation commit 666e776; four product roots preserved.
- [x] Shared instructions, eight skills, seven roles/workflows and Codex/Claude/OpenCode adapters.
- [x] Eight agent policy/adapter tests; deterministic generated-adapter checks.
- [x] Canonical v1 lesson/event schemas, generated TypeScript and standalone validators.
- [x] Three lesson fixtures, including Arabic RTL; four owned digital PDF fixtures and one
      synthetic vocalized Arabic page image used by OCR/conversion evaluation.
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
- [x] Arabic language plumbing end to end with mocked AI: explicit `ar` kid language, Arabic
      OCR via pinned best models, Arabic lesson fixture generation and RTL metadata (ADR 0010).
- [x] Phase 2 all six verticals: up to four kids per family with child switching in both
      UIs, a scrypt-hashed family PIN with server-side lockout gating the parent area plus an
      open child play view, assignments pinning approved revisions with kid-deletion sweep, a
      durable localStorage event queue flushed on load/interval/connectivity, approved-lesson
      and per-kid summary caching so play survives offline, and a per-child dashboard progress
      card fed by the idempotent events aggregate.
- [x] Cloudflare toMarkdown evaluated on four synthetic fixtures (doc/cloudflare-markdown-test.md):
      text-bearing PDFs convert with extra heading noise, image-only PDFs yield no text, and the
      image path returns a description rather than a transcription. Not adopted for ingestion.

- [x] Evaluation-only Cloudflare Gemma page OCR adapter and PDF integration, versioned
      Arabic transcription prompt, one-request cap and owned-fixture runner. Direct vision
      evidence is limited to one page. OCR_PROVIDER selects local or Cloudflare for approved
      owned-fixture emulator runs; production remains gated. Persisted attempt claims prevent
      repeat hosted sends. See doc/cloudflare-ocr.md and ADRs 0011–0012.

## Remaining Phase 0 evidence

- [ ] Native smoke sessions for every role/command in each supported agent. Claude CLI is absent;
      a second independent review attempt hit the account usage limit. Adapter tests do not replace this.
- [x] Current check evidence: 8 agent-policy plus 13 evaluator tests, 171 unit, 8 browser and
      3 emulator tests; the full integration check passed using temporary isolated loopback
      emulator ports, with the tracked configuration restored afterward. See verification.md.

## Remaining Phase 1 work and external gates

- [x] Native Android emulator journey: signup, consent, profile, owned PDF, WebView answer, approval and child deletion.
- [x] Upload-copy lifecycle cleanup, failure/race tests and Android seeded-residue startup recovery; see upload-cache-cleanup.md.
- [x] OCR binaries/scanner verified, source image extraction, stronger source-language detection:
      Docker tools smoke proves clamscan, rasterization and pinned tessdata_best English/Arabic
      OCR in the non-root worker; OCR-rasterized pages persist as family-scoped assets; per-page
      script detection plus explicit kid language replace the old Arabic rejection (ADR 0010).
- [x] Cloud Tasks/OIDC/outbox transport implemented behind injectable publishers/verifiers with
      fake-only tests, outbox/lease sweeper, deterministic idempotent task names and Cloud Run
      service templates; real cloud delivery and deployment remain gated and unverified.
- [ ] Approved real model/provider configuration, conservative live spend enforcement and live QA.
- [ ] Fix pre-existing page-image deletion fencing, live dispatch publisher wiring, OIDC
      certificate source and worker-template configuration gaps before family/cloud use;
      see the Cloudflare integration review in verification.md.
- [x] Two-book mocked prompt evaluation across both grades; real-model before/after reports remain pending.
- [ ] Region, retention/tombstone policy, legally sufficient parental consent and vendor processing review.

No live family data, MCP connections, pushes or deployments have been performed.
The user authorized and ran synthetic-only Cloudflare conversion/vision requests; see
the evaluation reports. No additional paid requests ran for the OCR adapter integration.
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

Phase 2: implemented; see Verified implementation.
Phase 3: additional launch curricula/languages and remaining five activities.
Phase 4: parent editing/regeneration UI and expanded moderation/evaluation quality.
Phase 5: broader markets, game shells and subscriptions.

## VPS migration — 2026-11-06

The user accepted a full no-Google VPS migration in
[ADR 0013](decisions/0013-self-hosted-vps-deployment-replacing-firebase-and-cloud-tasks.md):
PostgreSQL, Keycloak, MinIO, polling dispatch, Docker Compose and Caddy. The
migration is in progress; Firestore, Firebase Auth, Cloud Storage and Cloud Tasks
remain the active runtime until later phases land.

Phase 1 is implemented but not wired in: `PostgresRepository` covers path reads,
direct-child listing, serializable transactions and prefix deletion, with 11 tests
including a `FamilyService` create/delete scenario. Real-PostgreSQL transaction
verification, adapters for assets, auth, dispatch and client changes remain open.
No VPS was provisioned, no data was migrated, no Google dependency was removed from
the running app, and no live model or family-data use is authorized. See
[vps-migration.md](vps-migration.md).

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

# Milestones

Updated: 2026-11-06. Phase 0 and Phase 1 are in progress; Phase 2 is complete for the
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
PostgreSQL, Keycloak, S3-compatible storage, polling dispatch, Docker Compose and
Caddy. MinIO was replaced by Garage because MinIO withdrew its free distribution
([ADR 0014](decisions/0014-garage-replaces-minio-for-private-assets.md)). The
migration is in progress; Firestore, Firebase Auth, Cloud Storage and Cloud Tasks
remain the active document/auth/dispatch runtime until later phases land.

Phase 1 is implemented but not wired in: `PostgresRepository` covers path reads,
direct-child listing, serializable transactions and prefix deletion, with 11 tests
including a `FamilyService` create/delete scenario. Phase 2's `S3Assets` adapter is
implemented behind the existing `Assets` interface, wired with `ASSET_STORE=s3`, and
covered by 11 tests for bucket bootstrap, private writes, prefix isolation and
batches larger than 1000 objects. The Compose stack runs a digest-pinned Garage
service with a persistent volume, health check and private default bucket; real
put/get/prefix-delete, restart durability and anonymous-access rejection were checked
against it.

Phase 3 replaced Firebase Auth in the running app. Keycloak 26 with its own
PostgreSQL is in Compose, the realm and PKCE clients are configuration in
`backend/infra/keycloak/`, the API verifies Keycloak access tokens against the realm
JWKS, and account deletion also deletes the Keycloak identity
([ADR 0015](decisions/0015-keycloak-token-verification-and-admin-model.md)). The
website and mobile app use OIDC login and no longer bundle the Firebase SDK. A
Compose journey with `AUTH_PROVIDER=keycloak` passed end to end, and a real browser
login with PKCE loaded the parent dashboard without console errors. The committed
offline-sync browser journey registers through the Keycloak page, completes a lesson
offline and asserts exactly-once event sync on both viewports; it also drove a fix
for the dashboard progress card not loading after a reload. `POST /v1/parent/pin`
stays rate-limited to 5 requests per hour per client IP, which bounds local
browser-test repeatability (see [verification.md](verification.md)).

Real-PostgreSQL transaction verification, Firestore-to-Postgres wiring, polling
dispatch changes, VPS provisioning and mobile-device login remain open. No VPS was
provisioned, no data was migrated, and no live model or family-data use is
authorized. Firestore still stores family documents and Cloud Tasks remains the
cloud dispatch path. See [vps-migration.md](vps-migration.md).

## Admin panel — 2026-11-06

Decision recorded in
[ADR 0016](decisions/0016-role-gated-admin-panel-on-the-self-hosted-vps.md):
operators are a separate role-gated, audited account class on the existing Keycloak
realm, the panel is a route in `site/` behind Caddy on the same VPS, and the
append-only audit log ships before any capability. Phase A (identity, `/v1/admin/*`
plumbing, audit log) is the first increment; Phase B (ops visibility) is sequenced
behind the Postgres cutover; Phase C (moderation and support) follows. Nothing is
implemented yet, and parent impersonation is rejected. Every admin-surface change
requires the privacy-review skill before merge.

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

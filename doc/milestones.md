# Milestones

Updated: 2026-11-07. Phase 0 and Phase 1 are in progress; Phase 2 is complete for the
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
migration code is complete (2026-11-07): PostgreSQL, Keycloak and Garage are the
only document/auth/asset runtime and dispatch is the local polling worker. VPS
provisioning and mobile-device login remain open.

Phase 1 was implemented first and later wired in: `PostgresRepository` covers path reads,
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

Phase 4 cut the Compose runtime over to Postgres (2026-11-06): `REPOSITORY=postgres`
wires `PostgresRepository` with a validated connection URL, Firebase initializes only
when a Firebase surface is actually selected, the documents table pins `COLLATE "C"`,
and the real-Postgres behaviors pg-mem could not prove (rollback, serializable
conflict retries with backoff, byte-level edge cases) are covered by a gated
integration suite. `npm run docker:test` passed the full journey on Postgres and the
browser suite passed on the cut-over stack; see
[verification.md](verification.md). Real-PostgreSQL transaction verification is
done; VPS provisioning and mobile-device login remain open. No VPS was provisioned,
no data was migrated, and no live model or family-data use is authorized. See
[vps-migration.md](vps-migration.md). The Firebase/GCP runtime was removed entirely
the next day; see the 2026-11-07 removal section above.

## Firebase/GCP runtime removal — 2026-11-07

By explicit owner decision, the entire Google runtime was removed after the Compose
stack passed the full verification matrix on the new architecture (ADR 0013 phase 6,
run ahead of VPS provisioning). Rollback point: the `pre-firebase-removal` tag on
commit 65e6746.

- [x] Baseline on the new stack before removal: `docker:up` healthy,
      `docker:test` full journey passed, 12/12 browser tests including the real
      offline-sync and admin-panel journeys, full `npm run check` (the rules stage
      ran standalone because the Compose emulators service held the host ports).
- [x] Removed from code: `firebase-admin`, `@google-cloud/tasks`, `firebase-tools`,
      `@firebase/rules-unit-testing`; `FirestoreRepository`/`StorageAssets`;
      the cloud runtime mode (`CLOUD_RUNTIME_APPROVED`, Cloud Tasks publisher,
      outbox sweeper, OIDC worker endpoint); all `FIREBASE_*`/`GCLOUD_*`/`CLOUD_TASKS_*`
      settings; the Firebase emulators service, Dockerfile stage, rules files and
      `firebase.json`.
- [x] Defaults flipped: `AUTH_PROVIDER=keycloak`, `REPOSITORY=postgres`,
      `ASSET_STORE=s3` are the only accepted values; loopback defaults mirror the
      synthetic Compose credentials so `npm run dev` needs no env file. Every
      unknown or unsafe value still fails closed.
- [x] The rules suites were replaced as authorization evidence by the gated
      real-Postgres integration suite, the S3 adapter tests, and the `docker:test`
      assertions that anonymous Garage access is 403 and the API is 401.
- [x] The deploy gate now lists VPS settings and still fails by design.
- [x] Verification after removal: 256 unit tests, full `npm run check` with
      12/12 browser tests, and `docker:test` passed on the stack with no
      emulators service. See verification.md.

Open gates unchanged: no live model, no family data, VPS provisioning, native
mobile-device login, native iOS, TalkBack/RTL device checks.

## Admin panel — 2026-11-06

Decision recorded in
[ADR 0016](decisions/0016-role-gated-admin-panel-on-the-self-hosted-vps.md):
operators are a separate role-gated, audited account class on the existing Keycloak
realm, the panel is a route in `site/` behind Caddy on the same VPS, and the
append-only audit log ships before any capability. Phase A (identity, `/v1/admin/*`
plumbing, audit log), Phase B (ops visibility: cross-family job list, failed-job
retry, AI usage totals, and the 400-day audit retention decision) and the Phase C
support reads (family overview, subject-access export, deletion verification across
the repository and the identity provider, read-only lesson JSON) plus the `/admin`
panel route in `site/` are implemented and verified — see
[verification.md](verification.md). Rate limits for PIN set and uploads are
env-tunable with the 5/hour defaults unchanged. The monitor runs on the
storage-agnostic `Repository`, so the Postgres cutover swaps the driver underneath
it; the cutover still gates the runtime switchover. Still unbuilt: audit
export/pagination, storage-prefix deletion verification, moderation actions, and
the VPS provisioning items. Parent impersonation is rejected. Every admin-surface
change requires the privacy-review skill before merge.

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

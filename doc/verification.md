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

## Cloudflare integration review — 2026-11-05

The OCR adapter branch consolidates the Markdown and direct-vision experiment
histories, preserving their original reports and mocked tests. The Markdown scorer
now removes only the exact known converter headings; the original English CER
remains in the raw evidence, with the corrected zero score explained in the report.
Its CLI exclusively claims output before credentials or transport, rejecting
existing and interrupted batches instead of overwriting evidence or repeating spend.
The original vision harness remains for reproducibility; the bounded OCR runner is
the supported path for any separately approved future evaluation.

Security, privacy, schema and documentation review roles were applied to the
integration diff by the implementing agent. This is a self-review, not independent
reviewer coverage. The reviewed boundary is synthetic evaluation: the server still
constructs local Tesseract, hosted OCR selection fails startup, and the new runner
checks the owned fixture's hash. No family identifiers enter its request, no client
model integration was added, and errors omit upstream bodies and credentials.
The lesson/event contracts are unchanged. Hosted output remains untrusted text;
mocked tests do not prove extraction quality, consent adequacy or residency.

No new paid call, family-data processing, push or deployment is part of this merge.
The original direct-vision result covers one short page only. The broader corpus,
persisted spend enforcement and processor decisions remain open. Supported Node

> =24 execution also remains unverified on this host (Node 23.7.0); passing host
> checks must not be described as supported-engine verification.

Pre-existing launch issues remain outside this evaluation-only merge:

- The image sink in backend/src/stages.ts writes page images beside the source
  before the stage's fenced commit; backend/src/pipeline.ts assigns its cleanup
  attempt prefix only after ingestion. Stale OCR writes can recreate images after
  deletion and need a fenced asset lifecycle before family use.
- The server gives the real Cloud Tasks publisher only to the periodic sweeper;
  fresh FamilyService/Pipeline dispatch still uses default publishers.
- The worker needs its Google OIDC certificate source corrected and validated
  with genuine worker identity tokens before cloud delivery claims.
- The Cloud Run worker template lacks queue and worker identity settings required
  by runtime configuration. The template alone is not deployable evidence.

The production/deployment gates remain closed. Existing synthetic unit coverage
must not be used to dismiss those launch issues.

Full integration verification passed: npm run check completed successfully with
21 Node tests (8 agent-policy and 13 evaluator tests), 151 unit tests, all eight
browser tests and three emulator tests, plus lint, types, contracts/adapters,
fixtures, mocked evaluation and builds. Only this isolated worktree's temporary
emulator bindings changed to 19099/18080/19199 (hub 14400, logging 14500) during the
run; the tracked firebase.json was restored byte-for-byte afterward. The existing
development emulator stack was not stopped or reconfigured. All verification was
synthetic/mocked, and no new paid request ran.

## OCR provider environment switch — 2026-11-05

OCR_PROVIDER now selects local (default) or cloudflare in the backend runtime.
Cloudflare requires explicit development-run approval and injected credentials;
production remains rejected. Only the four owned PDF hashes are accepted. Fresh
per-book clients retain the one-page Arabic bound, and the worker shares a 1–4
attempt cap. Text-bearing English fixtures bypass OCR. The persisted job claim
checks active family/kid state, stage, lease and fence before transport and prevents
repeat sends after restart or downstream failure. This adds attempt idempotency,
not monetary budget reservation or approval for real family data.

Security/privacy/schema self-review confirmed that no credentials enter runtime
configuration output, API-only processes or client bundles. The existing job record
owns the new marker and family deletion removes it. The optional Compose overlay
adds worker-only settings and egress; default worker networking stays private.
Existing page-image lifecycle and cloud-transport launch issues remain open.
No independent reviewer or native-device verification is claimed for this change.

Full npm run check passed: 21 Node tests, 171 unit tests, eight browser tests and
three emulator tests, with lint, types, generated artifacts, fixtures, mocked
prompt evaluation and builds. Runtime bundle packaging also passed. Compose
configuration was resolved with synthetic credentials, without starting services.
The full check used temporary isolated loopback emulator ports, with the original
tracked configuration restored afterward. Host Node remains 23.7.0; supported
Node >=24 execution is still unverified. No live provider call, download, push or
deployment was performed for the selector.

## VPS migration phases 1–2 — PostgreSQL and S3 adapters — 2026-11-06

Added `backend/src/persistence-postgres.ts` behind the existing `Repository`
interface and 11 tests in `backend/tests/persistence-postgres.test.ts`. Tests cover
reads and missing documents, direct-child listing, path wildcard characters, upsert,
callback-abort discard, scoped prefix deletion, a `FamilyService` create/delete
scenario, and commit/rollback/serialization-retry control with an injected pool.
`pg-mem` supplies SQL behavior for tests; it does not implement transactions, so
rollback and serialization retries are asserted through the injected pool and still
require verification on real PostgreSQL before cutover.

Added `backend/src/persistence-s3.ts` with `S3Assets`, an AWS S3-compatible transport
and idempotent bucket bootstrap, plus 11 tests for bucket creation on 404 only,
private writes, invalid bucket names, missing-object mapping, directory and exact-path
deletion, >1000-object batching and path validation. `S3Assets` is wired into
`server.ts` behind `ASSET_STORE=s3`; runtime settings fail closed on missing, unsafe or
non-loopback S3 values, and cloud mode rejects the S3 store until Phase 4.

MinIO was replaced by Garage because MinIO withdrew its free distribution
([ADR 0014](decisions/0014-garage-replaces-minio-for-private-assets.md)). Compose now
runs `dxflrs/garage:v2.5.0` pinned by digest with a `garage-data` volume, a health
check and a private default bucket. Against the real local Garage endpoint, the
adapter created the bucket, stored a PDF, read the exact bytes back, prefix-deleted it
and mapped the follow-up read to `asset_not_found`. Anonymous object and listing
requests returned 403. An object stored before `docker compose restart garage` was
read back unchanged afterwards, confirming the metadata and data volumes persist.

`npm run docker:test` passed the full vertical journey with assets in Garage: the
synthetic parent signed up, consented, uploaded an owned English PDF and a scanned
Arabic PDF, the separated worker read both from Garage and completed scanning and OCR,
three drafts were published per book, approval and deletion succeeded, and the child
and account prefixes were empty afterwards. The final bucket listing reported zero
objects. The smoke also asserts `%PDF` bytes for each stored upload and that an
anonymous GET of the stored key returns 403.

`npm test` passes 214 unit tests and `npm run typecheck` passes. The Postgres adapter
is still unwired; Firestore remains the document store and Firebase Auth remains the
identity provider. No PostgreSQL, VPS, Google resource, provider call or deployment
was created or changed. Full `npm run lint` is temporarily blocked by an unrelated
untracked `site/tests/browser/offline-sync.spec.ts` from other work; the changed
files pass targeted ESLint and Prettier checks.

## VPS migration phase 3 — Keycloak authentication — 2026-11-06

Keycloak 26 runs in Compose with its own PostgreSQL database, a persistent volume and
a health check; the realm, two public PKCE clients and one confidential service
account are imported from `backend/infra/keycloak/realm-lessonbooks.json`. The API
verifies Keycloak access tokens in `backend/src/auth-keycloak.ts` (RS256, exact
issuer, `lessonbooks-api` audience, expiry, `sub` and `sid`), and the website and
mobile app use authorization-code + PKCE instead of the Firebase client SDK.

Observed against the running local services:

- A real access token carried `aud: lessonbooks-api`,
  `iss: http://127.0.0.1:8081/realms/lessonbooks` and a `sid`. The API returned 200
  for `/v1/family`; a tampered signature and a malformed token each returned 401, and
  a request without `Authorization` returned 401.
- `DELETE /v1/account` returned 200 immediately after login and the Keycloak admin API
  then reported no user with that name, so family deletion also removed the identity.
- `npm run docker:test` passed the full journey with a synthetic Keycloak parent:
  consent, an owned English PDF, a scanned Arabic PDF, worker scanning and OCR from
  Garage, three drafts per book, approval, child deletion and account deletion. The
  script re-authenticates before deletion because the recent-auth window is five
  minutes, and it leaves no objects behind.
- In the browser, the website redirected to Keycloak with an S256 `code_challenge`,
  completed the code exchange, loaded the parent dashboard through the API with no
  console errors, persisted the session across a reload, and signed out through the
  Keycloak end-session endpoint.

`npm test` passes 249 unit tests, including 21 Keycloak verification/admin tests and
recent-auth allow/deny cases. `npm run typecheck` and targeted ESLint/Prettier checks
pass. The Postgres adapter is still unwired; Firestore remains the document store.
The mobile iOS JavaScript export (`npm run export:ios`) bundles the OIDC client with
the SDK-matched `expo-auth-session` and `expo-web-browser`, and `app.json` now
registers the `lessonbooks` scheme used as the redirect URI.

Not verified: mobile login on a device or emulator (the redirect round trip needs a
running app), SMTP for verification/reset, VPS issuer/TLS, Keycloak backup/restore
and upgrade drills. The untracked `site/tests/browser/offline-sync.spec.ts` still
filled the removed Firebase email/password form at this point; it was rewritten and
committed later the same day — see the offline-sync browser journey entry below.

## Offline-sync browser journey — 2026-11-06

The untracked offline-sync spec was rewritten for the Keycloak stack and committed
(0bb0b67). It registers a synthetic family through the real Keycloak registration
page (the local realm allows registration and does not require email verification),
grants consent, creates a profile, sets the parent PIN, uploads the owned counting
fixture, approves and assigns a draft, then finishes all five activities with the
network offline and asserts that the queued events flush exactly once after the
backend becomes reachable.

Three timing issues were fixed while making it deterministic. The first family
request creates the parent record, so the spec waits for it before granting consent;
clicking faster failed the consent writes with `family_unavailable`. The desktop and
mobile Playwright projects run in parallel, so the synthetic email gains a random
suffix: same-millisecond usernames collided on Keycloak's unique
`(realm_id, username)` key. The restart step reloads with only the backend requests
aborted instead of emulating full offline: the site has no service worker, so a true
offline reload cannot refetch the app itself. Queue persistence, failed-flush
retention and exactly-once delivery are still asserted; a service-worker-backed
offline reload remains unimplemented and unverified.

The journey exposed a real site bug, fixed in f6ec0c1: the dashboard's `refresh()`
read a stale `selectedKidId` closure, so the progress card never loaded after a
plain reload and a kid-switcher click would fetch the previous child's progress.
`refresh()` now resolves the kid from the fetched family and selection-changing
callers pass the id explicitly. Unit coverage for this regression is still absent;
only the browser journey catches it.

`npm run test:player` passes 10/10 twice (eight example-mode player tests plus the
offline-sync journey on both viewports); typecheck, repo-wide lint and the 249 unit
tests pass, so the earlier lint block from the untracked spec is gone. The phase
notes above that mention the untracked spec are historical records of those runs.

Test-environment constraint: `POST /v1/parent/pin` is rate-limited to 5 requests per
hour keyed by client IP (`backend/src/api.ts`, in-memory store). Both Playwright
projects share 127.0.0.1, so one suite run consumes 2 of the 5; an exhausted quota
returns an opaque 429 and the pin form stays open. During verification the quota was
cleared by restarting `lessonbooks-api-1`. Repeatable browser testing needs one of:
an environment-tunable limit with unchanged defaults, per-user keying for pin
creation, or running the journey on the desktop project only. No rate-limit setting
was changed for these runs.

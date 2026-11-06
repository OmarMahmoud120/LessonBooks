# VPS migration plan

Status: in progress. Decision recorded in
[ADR 0013](decisions/0013-self-hosted-vps-deployment-replacing-firebase-and-cloud-tasks.md).
Target: single Linux VPS, Docker Compose, Caddy, PostgreSQL, Keycloak, Garage,
polling worker/outbox sweeper. No Google Cloud or Firebase runtime dependency.

This plan does not authorize live AI, real family data, public exposure or paid
provider calls. Those gates remain in [milestones.md](milestones.md) and
[privacy-compliance.md](privacy-compliance.md).

## Guiding boundaries

- Keep `Repository`, `Assets` and `TaskPublisher` as the replacement seams.
- Keep the lesson/event contracts, shared player, OCR/scanner worker and Docker
  packaging unchanged.
- The API remains the only data boundary. No client receives database or object-store
  credentials.
- Use synthetic/owned books for every migration test until legal and vendor
  decisions are complete.
- Do not delete the Firestore/Firebase adapters until the VPS path passes the full
  verification matrix; they are the rollback path.

## Phase 1 — PostgreSQL document store (implemented, verification pending)

Tasks:

- [x] Add `pg` to `@lessonbooks/backend`; use `pg-mem` for in-process tests.
- [x] Implement `PostgresRepository` for `get`, direct-child `list`, `atomic` and
      `deleteTree` in `backend/src/persistence-postgres.ts`.
- [x] Schema: `documents(path text primary key, data jsonb not null, updated_at)`.
- [x] Use serializable transactions with bounded retries for `atomic`; writes are
      queued inside the callback and applied in order before commit.
- [x] Preserve path-based family namespacing (`parents/{uid}/...`) and prefix ranges
      that do not depend on LIKE wildcard escaping.
- [x] Tests: get/missing, direct-child listing, wildcard characters in paths,
      upsert, callback-abort discard, prefix isolation, FamilyService create/delete,
      commit/rollback/retry control with an injected pool.
- [ ] Verify rollback, serialization retry and byte-level behavior against a real
      PostgreSQL instance on the VPS. `pg-mem` does not implement transactions, so
      the current tests use an injected pool for transaction control and pg-mem for
      SQL behavior.

Evidence: 11 new tests pass; `FamilyService` creates and deletes a child through the
adapter. The repository is not yet wired into `server.ts`; Firestore remains the
active runtime until the remaining phases land.

Acceptance: `FamilyService`, `Pipeline` and `OutboxSweeper` tests pass unchanged
against the Postgres repository, and the real-Postgres transaction check above is
recorded.

## Phase 2 — S3-compatible asset store (Garage; local integration verified)

MinIO was the original vendor; it was replaced by Garage after MinIO withdrew its
free distribution. See
[ADR 0014](decisions/0014-garage-replaces-minio-for-private-assets.md).

Tasks:

- [x] Implement `S3Assets` over a narrow `S3Transport` and the AWS S3-compatible
      adapter in `backend/src/persistence-s3.ts`; `@aws-sdk/client-s3` is the only new
      runtime dependency.
- [x] Private objects only: no public ACLs, no signed URLs, `private, no-store`
      cache control and the existing content type.
- [x] Prefix deletion used by job/child/account deletion, exact-path deletion for
      replaced uploads, and batch deletion at the S3 limit of 1000 objects.
- [x] Reject empty, absolute and parent-traversing keys before transport; bootstrap
      the private bucket with HeadBucket/CreateBucket.
- [x] Tests: bucket bootstrap, put/get metadata, missing-object mapping, directory
      prefix isolation, exact-path deletion, >1000-object batching and validation.
- [x] Compose Garage service (`dxflrs/garage:v2.5.0`, digest-pinned) on the private
      network with a persistent `garage-data` volume and health check; single-node
      layout, access key and bucket created by `--single-node --default-bucket`.
- [x] Wire `S3Assets` into `server.ts` behind `ASSET_STORE=s3` and fail closed on
      missing or unsafe S3 settings.
- [x] Run the emulator vertical journey with files stored in Garage and assert the
      stored PDF bytes, then empty prefixes after child and account deletion.
- [ ] Provision the VPS Garage service with generated secrets, encrypted volumes,
      off-site backup/restore and deletion drills. The local synthetic credentials
      and `garage.toml` are not a production configuration.

Evidence: 11 adapter tests and real Garage put/get/prefix-delete checks pass; the
Compose journey stores PDFs in Garage, the worker reads them for OCR, and deletion
leaves no objects. Firestore remains the document store and Firebase Auth remains
the identity provider until later phases.

Acceptance: the emulator vertical journey passes with files stored in Garage and the
same family-scoped deletion behavior; VPS durability and restore verification remain
open.

## Phase 3 — Keycloak authentication (implemented, VPS/device verification pending)

Decisions for token verification, recent authentication and identity deletion are
recorded in [ADR 0015](decisions/0015-keycloak-token-verification-and-admin-model.md).

Tasks:

- [x] Add Keycloak 26 and a PostgreSQL service to Compose, with a persistent
      `keycloak-db-data` volume, health checks and the database on the private
      network. Keycloak needs a writable root because `start` auto-builds; the VPS
      image should bake `kc.sh build` and run `--optimized`.
- [x] Realm and clients as code in `backend/infra/keycloak/realm-lessonbooks.json`:
      `lessonbooks-site` and `lessonbooks-mobile` are public PKCE clients with
      `S256`, an audience mapper for `lessonbooks-api`, five-minute access tokens
      and refresh-token rotation. `lessonbooks-api` is a confidential service
      account with `view-users` and `manage-users`.
- [x] Replace the Firebase client SDK in `site/src/ParentApp.tsx` and
      `mobile/App.tsx` with OIDC authorization-code + PKCE (`oidc-client-ts` and
      `expo-auth-session`); both clients now send an access token, refresh it, and
      sign out through Keycloak. `firebase` is no longer a dependency of either.
- [x] Replace Firebase token verification in `backend/src/auth-keycloak.ts`:
      RS256 JWKS verification of signature, issuer, audience and expiry, requiring
      `sub` and `sid`, with the JWKS fetched from an internal backchannel URL.
- [x] Preserve recent auth for PIN set and account deletion by resolving the SSO
      session start through the admin API, failing closed when it cannot be proven.
- [x] Delete the Keycloak identity when a family is deleted.
- [x] Tests: valid, expired, wrong-issuer, wrong-audience, wrong-key, unsigned,
      malformed, missing-`sid` tokens; admin token caching; user deletion
      success/404/refusal; session lookup and revocation; recent-auth allow/deny.
- [ ] Email delivery (SMTP) for verification and password reset, and the decision to
      keep registration open, invite-only or admin-created.
- [ ] Mobile login on a device or emulator, including the custom-scheme redirect.
- [ ] Keycloak backup/restore and upgrade drills on the VPS.

Evidence: the Compose journey signs in with a synthetic Keycloak user, stores assets
in Garage, completes the lesson pipeline and deletes both the family documents and
the Keycloak identity. The website completed a real PKCE login in a browser with no
console errors. The committed offline-sync browser journey registers a family
through the Keycloak registration page, completes a lesson offline and asserts
exactly-once event sync on both viewports; it also drove the dashboard progress-card
fix after reload. The `POST /v1/parent/pin` limit of 5 requests per hour per client
IP bounds local browser-test repeatability (see [verification.md](verification.md)).

Acceptance: website and mobile complete login and authorized API calls against
Keycloak; the API rejects every invalid token class; identity deletion is verified.

## Phase 4 — Dispatch and runtime configuration

Tasks:

- Make polling + `OutboxSweeper` the VPS worker path; remove Cloud Tasks and OIDC
  endpoint use from VPS configuration.
- Replace GCP runtime settings with Postgres, S3-compatible storage (Garage), Keycloak and public-base-URL
  settings; fail closed on missing or unsafe values.
- Keep attempt/lease/fence/idempotency behavior unchanged.
- Remove `CLOUD_RUNTIME_APPROVED` branches from the VPS runtime or keep them
  explicitly unsupported.
- Tests: lost dispatch recovery, stalled lease recovery, duplicate polling, deletion
  wins over stale worker.

Acceptance: uploads complete through the polling worker with no Google environment
variables and no outbound Cloud Tasks calls.

## Phase 5 — Deployment and operations

Tasks:

- `compose.vps.yaml`: Caddy, site, api, worker, postgres, keycloak, garage, optional
  signatures updater; private networks; read-only containers; resource limits.
- Caddy TLS with automatic certificates; only 80/443 public, SSH restricted.
- PostgreSQL and Garage off-site encrypted backups, retention and restore script.
- Secrets via Docker secrets/SOPS/Vault, never committed; `.env` remains excluded.
- Monitoring: uptime, disk, memory, backup success, queue depth, failed jobs.
- Log scrubbing; no book text, tokens, child names or credentials.
- Patch policy and migration/rollback runbook.

Acceptance: documented restore drill, deletion drill, TLS verification and a
synthetic end-to-end smoke on the VPS.

## Phase 6 — Test-suite replacement and cutover

Tasks:

- Replace Firebase emulator and rules tests with Postgres/Keycloak/Garage integration
  tests. Keep API-level ownership tests as the primary authorization evidence.
- Update `npm run check`, `phase-status` and the deploy gate for VPS settings.
- Update milestones, architecture, data model, API and privacy docs.
- Run the migration in parallel: export a synthetic dataset, run both stacks, compare
  behavior, then cut over.
- Keep a rollback branch and Firestore adapters until one successful VPS verification
  cycle is recorded.

Acceptance: `npm run check` passes with no Google runtime dependency; recorded VPS
smoke and restore/deletion evidence; rollback path documented.

## Open decisions

- VPS provider, country and backup region (residency and processor review).
- Whether parent registration is open, invite-only or admin-created.
- Email delivery for Keycloak verification/reset (SMTP provider and terms).
- Retention periods, inactive-account cleanup and backup expiry.
- Garage single-node durability versus a multi-node layout plus off-site backup.
- TLS/DNS names and operational ownership.
- Live AI provider/spend approval remains separate and still closed.

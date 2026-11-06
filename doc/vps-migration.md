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

## Phase 3 — Keycloak authentication

Tasks:

- Add Keycloak + its PostgreSQL schema to Compose.
- Realm and client configuration as code (web public client with PKCE; mobile public
  client with PKCE); no client secret in the website or app.
- Replace Firebase client SDK usage in `site/src/ParentApp.tsx` and `mobile/App.tsx`
  with OIDC login, token refresh and logout.
- Replace backend Firebase token verification with Keycloak JWKS verification:
  signature, issuer, audience, expiry and `sub`.
- Preserve recent-auth requirements for PIN set and account deletion using
  `auth_time` or a re-authentication flow.
- Disable public self-service registration if parent accounts should be invite-only;
  decide before launch.
- Tests: valid/expired/wrong-issuer/wrong-audience/malformed tokens, disabled user,
  refresh, logout, recent-auth enforcement, no token logging.

Acceptance: website and mobile complete signup/login and authorized API calls against
Keycloak; API rejects all invalid token classes.

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

# 0013: Self-hosted VPS deployment replacing Firebase and Cloud Tasks

Status: Accepted; storage vendor superseded by
[0014](0014-garage-replaces-minio-for-private-assets.md)
Date: 2026-11-06

## Context

The current runtime depends on Google services: Firebase Auth for parent identity,
Firestore for family documents, Cloud Storage for private assets, and Cloud Tasks
with Google OIDC for worker dispatch. Local development runs the Firebase emulators,
and `npm run deploy` is blocked until cloud decisions are recorded.

The user wants the application to run on a VPS without a Google Cloud project. The
code already isolates persistence (`Repository`/`Assets` in
`backend/src/persistence.ts`), dispatch (`TaskPublisher` in
`backend/src/transport.ts`) and runtime settings (`backend/src/runtime-config.ts`),
so Google-specific code is replaceable without changing the lesson, event or player
contracts. The remaining coupling is authentication: the website and mobile app use
the Firebase client SDK, and the API verifies Firebase ID tokens.

Constraints that continue to apply: parent accounts only, no child identity, no
trackers, no client model calls, private family namespaces, asynchronous bounded
generation, and no live provider or family-data use until the existing legal and
spend decisions are recorded.

## Decision

Deploy the product on a single Linux VPS using Docker Compose behind Caddy, with:

- **PostgreSQL** as the document store, implemented behind `Repository`; Firestore
  remains only as a historical adapter during migration.
- **Keycloak** as the OpenID Connect identity provider, backed by PostgreSQL, with
  authorization-code + PKCE for the website and mobile app. The API verifies
  Keycloak-issued JWT access tokens and derives parent identity from `sub`.
- **MinIO** (S3-compatible) for private assets behind `Assets`, on an isolated
  internal network with encrypted off-site backups. No public bucket or object URL.
- **Polling worker plus the existing outbox/lease sweeper** for generation dispatch.
  Cloud Tasks, OIDC task tokens and the internal worker HTTP endpoint are removed
  from the VPS runtime.
- **Caddy** for TLS and static site delivery; the API, worker, PostgreSQL, Keycloak
  and MinIO stay off the public internet except through the reverse proxy or SSH.
- **Single-VPS initial topology**, explicitly not highly available. Backups,
  restore drills, disk alerts and patching are part of the deployment, not optional.

The migration is phased: storage/persistence adapters first, then auth, then
dispatch, then cutover and decommissioning of Google-specific configuration. The
existing Docker packaging, OCR/scanner worker, schemas, player and mobile bundle are
retained.

The storage vendor was later changed from MinIO to Garage because MinIO withdrew its
free distribution; see [ADR 0014](0014-garage-replaces-minio-for-private-assets.md).
The remaining decision content is unchanged.

## Consequences

- No Google Cloud project, Firebase project, Cloud Tasks queue or Google service
  account is required at runtime.
- The project becomes responsible for authentication security, database upgrades,
  object-storage durability, TLS, backups, monitoring, incident response and
  availability. A single VPS has no managed failover.
- Keycloak adds a Java service and roughly 1–2 GB of memory; MinIO adds storage and
  backup volume. The VPS baseline rises to at least 4 vCPU / 8 GB RAM.
- Firestore/Storage security rules disappear. The API becomes the only data
  boundary, so ownership and authorization tests are mandatory; direct client
  database access was already denied and is not replaced.
- Existing Firebase emulator and rules tests must be replaced with Postgres/Keycloak
  integration tests. Emulators must never be exposed publicly.
- Provider decisions for OpenRouter and optional Cloudflare OCR remain unchanged and
  still require vendor, residency and spend approval. This decision does not enable
  live AI or real family data.
- Data residency, backup location, retention periods and deletion SLAs are VPS
  hosting decisions that still need explicit approval before family use.

## Alternatives considered

- **Keep Firebase with VPS compute (hybrid).** Less work, but still depends on Google
  and does not meet the stated goal.
- **Self-hosted Supabase.** Bundles Postgres, auth and storage, but adds a large
  multi-container platform with overlapping responsibilities and less control over
  the auth boundary.
- **Ory Kratos or SuperTokens.** Lighter auth options; Keycloak was chosen for its
  mature OIDC support, admin UI, email verification, reset and MFA flows at the cost
  of memory.
- **Redis/BullMQ or pg-boss.** Better push latency, but more moving parts; the
  existing polling/sweeper design is sufficient for bounded family workloads.
- **Firestore-compatible third-party server.** No production-grade, maintained
  emulator replacement was accepted as a launch dependency.

## Verification

Migration acceptance requires:

- Postgres `Repository` and MinIO `Assets` tests covering reads, direct-child listing,
  transactions/rollback, prefix deletion and deletion races; the same family
  authorization tests pass against the new adapters.
- Keycloak login, token refresh, logout, disabled-user and expired-token tests for
  both website and mobile, plus API rejection of missing, malformed, wrong-issuer and
  wrong-audience tokens.
- A Compose smoke on the VPS: TLS, signup, consent, child, owned PDF, OCR, three
  drafts, approval, progress events and deletion, with no Google credentials or
  environment variables present.
- Backup and restore drill for PostgreSQL and MinIO; documented retention and
  deletion verification.
- `npm run check` passes with Google emulator/rules tests replaced by the new
  integration tests; no Firebase or Cloud Tasks imports remain in the VPS runtime.
- Documentation, milestones and the deployment gate reflect VPS settings, and all
  live-provider, spend, residency and consent gates remain explicit.

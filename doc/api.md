# API

Proposed v1 surface; implementation and tests must be reconciled here as endpoints land.

Parent requests use Authorization: Bearer <access token>. The default provider is Firebase Auth and verifies tokens through the Admin SDK; `AUTH_PROVIDER=keycloak` verifies RS256 access tokens against the realm JWKS and requires the configured issuer and audience. In both cases the API derives parentId from the verified `sub` and never accepts a request-selected owner. PIN set and account deletion require a recent interactive login (five minutes), resolved from the Keycloak SSO session start so a client cannot forge it. Local emulator tokens are accepted only in explicit emulator mode. Responses containing family data use Cache-Control: no-store.

| Method/path                  | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| GET /health                  | non-sensitive liveness                                |
| GET /v1/catalog              | public supported curricula                            |
| GET /v1/family               | parent's profile, consent, children and `pin_set`     |
| POST /v1/consents            | versioned consent choice                              |
| POST /v1/kids                | validated minimal child profile (max four per family) |
| DELETE /v1/kids/:id          | cancellation and erasure                              |
| DELETE /v1/account           | recent-auth account erasure                           |
| POST /v1/parent/pin          | recent-auth PIN set/change (hashed server-side)       |
| POST /v1/parent/pin/verify   | bounded PIN verification with lockout                 |
| POST /v1/books               | bounded PDF upload; returns book/job IDs              |
| GET /v1/jobs/:id             | stage, progress and sanitized error                   |
| GET /v1/lessons              | own-family summaries                                  |
| GET /v1/lessons/:id          | private JSON for parent preview                       |
| POST /v1/lessons/:id/approve | approve exact current revision                        |
| POST /v1/assignments         | pin an approved lesson revision to a kid              |
| GET /v1/assignments          | own-family assignments                                |
| DELETE /v1/assignments/:id   | remove an assignment                                  |
| POST /v1/events              | up to 50 schema-validated play events; idempotent     |
| GET /v1/kids/:id/progress    | per-kid events aggregate for the dashboard            |

Admin routes (ADR 0016) live under `/v1/admin/*` for identities holding the
`lessonbooks-admin` realm role with a recent interactive login; every action is
recorded in the append-only audit log: job list and retry, AI usage totals, audit
read, family overview, subject-access export, deletion verification and a read-only
lesson JSON view. They never create family state and never expose credential
material.

Use non-guessable IDs plus ownership checks. Reject unknown request fields, unsupported locale/curriculum combinations and invalid references. Upload type/magic, byte/page limits and rate limiting apply before costly parsing/model calls. A supplied idempotency key is scoped to parent and operation. Errors return safe codes, never raw provider responses or stack traces.

The private worker endpoint requires a Cloud Tasks OIDC service identity and cannot be reached using a parent token. Site/mobile progress events are validated by the shared event schema and persisted per kid; the API derives kid identity from the lesson record, rejects revision mismatches and deduplicates by event_id, so this is not an unauthenticated ingestion shortcut. Event batches are capped at 50 and rate-limited.

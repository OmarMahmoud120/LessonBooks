# 0016: Role-gated admin panel on the self-hosted VPS

Status: Accepted
Date: 2026-11-06

## Context

The product surface is parent-only: parents upload books, review generated lessons
and manage their own family. Operating the service still needs a human surface for
jobs that parents cannot do — watching the generation pipeline, triaging failures,
moderating lesson content, and answering support questions such as "was this account
really deleted". Nothing exists for this today: the API routes are parent-facing
only, and the only "admin" in the codebase is the server-side Keycloak client from
[ADR 0015](0015-keycloak-token-verification-and-admin-model.md), which is plumbing,
not a panel.

Adding an operator surface creates a new account class. The architecture invariant
"parent accounts only" exists because every private resource belongs to one family
and no public surface may expose family data; an admin panel by definition crosses
family boundaries. Building one without written rules would let operator access
quietly become a bypass around every family-scoping guardrail.

The self-hosted deployment from
[ADR 0013](0013-self-hosted-vps-deployment-replacing-firebase-and-cloud-tasks.md)
already provides the pieces a panel needs: Keycloak for identity, Caddy for
termination and routing, Docker Compose for co-hosting, and a single backend that is
the only caller of paid AI. The Postgres cutover (migration phase 4) is still open.

## Decision

- **Operators are a separate, role-gated account class.** The "parent accounts only"
  invariant continues to govern the product; operator access is recorded here as its
  own class with its own rules. Admin identity is the `lessonbooks-admin` realm role
  on the existing Keycloak realm, held on a confidential `lessonbooks-admin-panel`
  client with an audience mapper for `lessonbooks-api`. Sensitive admin actions
  require recent authentication like PIN changes do. Every check fails closed.
- **A separate API surface.** Admin capabilities live under `/v1/admin/*` with
  per-route role checks, never mixed into parent routes. Each capability
  (ops, moderation, support) is a distinct permission so an operator can hold the
  minimum set.
- **Audit first.** An append-only audit log (actor, action, target, time) is part of
  the first increment and records every admin action. It cannot be retrofitted
  onto a panel that has already been used, so it ships before any capability.
- **The panel is a route in `site/`.** One React app, no new build tooling, served
  behind Caddy on the same VPS. No third-party analytics, no ads, and the kid-facing
  player is never embedded in the admin surface.
- **Data minimization rules for operators.** Family lookup is by parent identifier,
  never by child nickname. Child content is shown read-only as versioned lesson JSON
  (AI emits data, not code), never as the interactive player. Impersonating a parent
  is rejected outright; deletion verification and data export cover the support need
  without it.
- **Phasing.** Phase A: identity, `/v1/admin/*` plumbing, audit log. Phase B: ops
  visibility — job/stage/queue monitor, retry and cancel, spend counters against
  persisted usage records — built after the Postgres cutover so the monitor is
  written once. Phase C: moderation (review queue, read-only lesson JSON, deactivate
  a revision) and support (family lookup, deletion verification across Firestore/
  Garage/Keycloak, subject-access export). Spend/budget and route-policy editing
  from the UI is deferred; the deterministic policy remains the enforcement point.

## Alternatives considered

- **Separate admin application or repository** — rejected: extra build and deploy
  tooling for a surface that talks to the same backend; a route in `site/` ships the
  same capability with less machinery.
- **Separate Keycloak realm for operators** — rejected: identity sprawl for a small
  operator set. Role separation inside the existing realm with per-route checks and
  the audit log gives the same isolation. Revisit only if the operator group grows
  or an operator must not be able to manage parents at all.
- **Parent impersonation for support** — rejected: it defeats the family-boundary
  model, is the hardest thing to audit honestly, and the same outcomes are reachable
  through deletion verification and exports.
- **Ops visibility on Firestore before the Postgres cutover** — rejected: the job
  monitor would be written twice. Phase B is sequenced behind migration phase 4.

## Consequences

- AGENTS.md's invariant line is updated to name the operator class so the rule is
  not silently contradicted by the codebase.
- The audit log is a new durable store with an open retention decision that must be
  recorded before any real family data flows through admin tooling.
- The panel shows operational truth, not quality verdicts: like the pipeline docs
  say, scripted checks do not assess learning quality; moderation review is human
  judgment with tooling.
- Phases B and C land after the Postgres cutover and are future design until then;
  nothing in this decision moves the migration schedule.

## Verification

The decision itself is recorded, not implemented. Each phase lands with its own
evidence: Phase A requires tests for role-gated 401/403 on every `/v1/admin/*`
route, an audit entry asserted for every admin action, recent-auth enforcement and
fail-closed behavior when the identity provider is unreachable; Phase B and C add
their verification entries to milestones. The privacy-review skill applies to every
admin-surface change before merge, and no phase is complete without it.

## Retention and phase B sequencing (recorded 2026-11-06, same day)

Two follow-up decisions made while implementing phases A and B, recorded here
because this decision named both as open.

- **Audit retention**: entries are retained for 400 days. Each write lazily prunes
  expired entries (bounded batch) inside its own transaction, so no sweeper exists
  and the log cannot grow unbounded even if writes stop. Entries hold operator
  identities, actions and opaque target identifiers — never child profile content —
  and the retention window is revisited if operator volume grows enough to matter.
- **Phase B sequencing**: the original text sequenced ops visibility behind the
  Postgres cutover because a monitor "would be written twice". The implemented
  monitor reads and acts only through the storage-agnostic `Repository` interface
  and `FamilyService` — the same abstractions the family surface uses — so the
  cutover swaps the driver underneath it without changing the monitor. The cutover
  still gates the runtime switchover; it no longer gates the monitor code.
- **Panel authentication** (phase C slice): the `/admin` route authenticates
  operators through the existing public `lessonbooks-site` PKCE client instead of
  the confidential client — a browser app cannot hold a client secret, and the
  realm role plus server-side route gates carry the authorization regardless of
  which client issued the token. The confidential `lessonbooks-admin-panel` client
  and its service account remain for future server-mediated operator flows and
  scripted verification. The role check in the panel decides only what to render;
  every capability is enforced per route server-side.
- **Rate-limit tuning**: the 5/hour defaults for PIN set and book upload stay the
  documented posture, but `RATE_LIMIT_PIN_PER_HOUR` and `RATE_LIMIT_UPLOADS_PER_HOUR`
  (bounded 1–1000, invalid values fail startup) allow the local Compose stack to
  raise them for browser-test repeatability. The VPS keeps the defaults until a
  launch decision changes them.

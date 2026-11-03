# 0007: asynchronous jobs

Status: Accepted
Date: 2026-11-03

## Context

At-least-once delivery must not duplicate publication. Local dispatch supports emulator development without pretending to prove Cloud Tasks IAM.

## Decision

Use Cloud Tasks with private workers, persisted stages, leases/fencing, idempotency and recovery outbox.

## Consequences and verification

Implement in small vertical steps; verify applicable criteria in ../milestones.md. Any material change requires a superseding ADR.

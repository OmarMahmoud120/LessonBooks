# 0006: family tenancy

Status: Accepted
Date: 2026-11-03

## Context

Admin SDK bypasses rules, so API/worker cross-family tests are mandatory. Deletion tombstones cancel stale generation. Nicknames still constitute personal data.

## Decision

Private family namespaces; authenticated API owns all private access, with direct client rules denying everything.

## Consequences and verification

Implement in small vertical steps; verify applicable criteria in ../milestones.md. Any material change requires a superseding ADR.

# 0003: canonical contracts

Status: Accepted
Date: 2026-11-03

## Context

No new product root. Regeneration and version/capability checks prevent drift. Never manually edit generated files.

## Decision

Keep JSON Schema source in doc/specs and generated types/validators in the doc/contracts workspace package.

## Consequences and verification

Implement in small vertical steps; verify applicable criteria in ../milestones.md. Any material change requires a superseding ADR.

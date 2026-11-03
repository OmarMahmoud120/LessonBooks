# 0005: openrouter decision model

Status: Accepted
Date: 2026-11-03

## Context

No client keys or arbitrary model/provider routes. Mocked calls are default; include routing usage in budgets. Provider residency, spending and retention are launch gates.

## Decision

Route backend-only AI requests through OpenRouter; a decision model proposes approved route IDs and deterministic policy authorizes them.

## Consequences and verification

Implement in small vertical steps; verify applicable criteria in ../milestones.md. Any material change requires a superseding ADR.

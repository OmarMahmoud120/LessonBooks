# 0009: Backend Docker runtime packaging

Status: Accepted
Date: 2026-11-04

## Context

The user requested backend and OCR Docker setup before more OCR work. The current
entrypoint combines HTTP and polling with loopback emulator addresses.

## Decision

Use separate API, OCR-worker and emulator targets in one multi-stage Dockerfile.
Bundle application TypeScript/internal contracts into ESM, retaining third-party
runtime packages as external dependencies. Ship the PDF worker beside the bundle.
Pin Node 24 and Java 21 base digests. Only the worker includes native OCR/scanner tools.

Compose runs API/worker on an internal emulator network. A separate definition
updater has outbound access and no family data. Require scanner definitions before
worker startup; mount them read-only in the worker. Use loopback host ports, non-root
users, dropped capabilities, bounded tmpfs and resource limits. Persist emulator
exports and scanner definitions in named volumes.

Runtime images retain the production/live startup gate. Compose explicitly selects
synthetic development. Packaging does not enable cloud transport or authorize live use.

## Consequences

A combined container would give HTTP handlers unnecessary native parser tools.
A new OCR HTTP service would introduce transport before its contract is defined.
The existing worker hosts OCR for now. Cloud Tasks/OIDC remains separate work.
Definitions, OS packages and pinned base images require maintenance.

## Verification

Run runtime-policy tests, image builds, native tool checks and synthetic API-to-worker
smoke tests. Record evidence and external download failures in ../docker.md.

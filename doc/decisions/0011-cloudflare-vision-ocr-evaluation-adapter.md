# 0011: Cloudflare vision OCR evaluation adapter

Status: Accepted for owned synthetic evaluation only
Date: 2026-11-05

## Context

[ADR 0010](0010-tiered-arabic-ocr-strategy.md) adopts local Tesseract as the current
fallback and leaves hosted vision behind provider, privacy and budget decisions.
Cloudflare toMarkdown failed to transcribe scanned Arabic fixtures. A subsequent
user-run direct Gemma vision request preserved all normalized base letters on one
owned vocalized page, with 0.06321839 CER when marks were retained. It changed
several source vowel marks. This is promising evidence, not a production benchmark.

## Decision

Add an injectable page OCR interface and Cloudflare Gemma adapter in the backend,
with the exact tested Arabic prompt versioned as `ocr.ar.v1`. Exercise PDF
rasterization, scanning, metadata and failure paths with mocked transport. Keep
Tesseract selected in the deployed API/worker, and reject hosted OCR runtime
selection until the missing family-data and spend controls are reviewed.

Provide an explicitly live, hash-pinned synthetic-image runner. Restrict each
adapter to one attempted call and one Arabic page; enforce input, response, token
and time bounds; reject incomplete output; never retry or silently change providers.
Claim the evaluation output before a send so failed or concurrent runs cannot
silently repeat spend. Report estimated token cost, without claiming an invoice or
persisted job budget enforcement.

This supplements ADR 0010 for evaluation. It does not authorize direct Cloudflare
processing of family books, replace the proposed production routing decision, or
alter OpenRouter generation policy. A new production decision must cover processor
approval, routing, persisted reservations, idempotency, cancellation and deletion.

## Alternatives

- Adopt toMarkdown: rejected by the scanned-PDF and literal-transcription results.
- Replace local OCR immediately: rejected because one page cannot prove quality,
  and family processing approvals plus durable spending controls are incomplete.
- Add Surya now: requires a separate license, deployment and download decision;
  direct vision can be compared without adding model weights to the backend image.
- Keep only a standalone script: insufficient to verify PDF integration and failure
  handling. A reusable adapter allows those checks while family runtime stays gated.

## Consequences

The backend gains no dependencies and no client model calls. Arabic-only evaluation
limits avoid implied support for unseen languages. The one-request cap bounds
attempt count, not account-wide spend: a fresh process can spend again. Estimates
use current published rates; prices and tokenization can change. Output remains
untrusted text and requires parent review before any later family adoption.

## Verification

See [Cloudflare OCR](../cloudflare-ocr.md) for preserved live evidence, limits,
commands and the remaining production gates. This change performs no new paid call.
Mocked prompt evaluation before/after retains generation prompt version 1, policy
version 1, valid schemas, answer consistency, grade fit and private drafts at $0.
OCR tests prove adapter behavior, not real-model accuracy or residency guarantees.

Follow-up: [ADR 0012](0012-selectable-ocr-for-owned-synthetic-development.md) adds
a gated runtime selector for owned synthetic emulator runs while retaining the
production/family-data boundary.

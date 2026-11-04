# 0010: Tiered Arabic OCR strategy

Status: Accepted
Date: 2026-11-04

## Context

Arabic is the next launch language: the lesson schema, direction field and an Arabic
lesson fixture exist, and the player renders RTL with axe coverage. The ingestion
pipeline, however, rejected Arabic books outright (`unsupported_source_language`),
hardcoded English OCR (`tesseract -l eng`) and always reported the extracted language
as `en-GB`. Kid profiles accept only `en-GB`. Research for the best-quality local
Arabic OCR found: KITAB-Bench (ACL 2025) shows Tesseract Arabic accuracy is poor
compared with modern systems; Surya has the best self-hosted open-source Arabic CER
(~0.199) but now ships a 689M-parameter vision model requiring a llama.cpp/vLLM
sidecar and gigabytes of model weights under a modified Open Rail-M weight license;
vision-language model APIs top the benchmark but send family book images to external
providers, which requires the live-provider approval gates that remain closed.

## Decision

Adopt a tiered OCR strategy. Tier 1, implemented now and fully local: Tesseract with
the tessdata_best Arabic and English LSTM models (pinned by sha256 at image build),
OCR language derived from the explicit kid language (`ar` rasterizes at higher scale
and recognizes `ara+eng`), Arabic presentation-form normalization (NFKC, tatweel
strip), per-page script-range language detection persisted with the extracted text,
and OCR-rasterized page images persisted as private family assets. Kid profiles gain
the explicit `ar` language; the mock generation route serves Arabic from the existing
fixture. Tiers recorded for later, behind the same Ingestor interface: Tier 2 is a
Surya sidecar (best local quality; needs license confirmation and large downloads);
Tier 3 is a vision-model route through the existing OpenRouter decision-model policy
(best quality; needs live-provider approval, spend controls and a family-consent
decision on sending book images to a processor).

## Consequences

Tesseract Arabic remains the weakest local tier: vocalized/diacritized children's
text keeps a high character error rate, so tier 1 is a plumbing and fallback layer,
not the quality ceiling. The binary-tampering surface grows by two pinned model files.
Page images duplicate book content inside the same family storage scope; they inherit
existing family deletion and are bounded by the page limit. The
`unsupported_source_language` failure remains permanent and now triggers only for
languages outside the supported profile set. Interfaces gained a language parameter
and an image sink, keeping mocked tests independent of native binaries.

## Alternatives considered

Replacing Tesseract with Surya immediately was rejected for this round: the image
cost, model downloads and a weight-license confirmation are decisions with external
dependencies, while tier 1 unblocks Arabic profiles, extraction and evaluation now.
Calling a commercial OCR API was rejected because family book images would leave the
trust boundary before the remaining live-provider, retention and consent decisions.

## Verification

Unit tests cover language mapping, Arabic normalization, per-page detection and
injected-run OCR argument capture without native binaries. The Docker native-tools
smoke rasterizes and recognizes the committed image-only Arabic fixture with the
pinned `ara` model, and the API smoke exercises an Arabic profile end to end with
mocked AI. `npm run check` must pass. Tier 2/3 quality comparisons remain future work
and must be re-evaluated against KITAB-Bench results when implemented.

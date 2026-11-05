# 0012: Selectable OCR for owned synthetic development

Status: Accepted for owned synthetic development only
Date: 2026-11-05

## Context

The user requested an environment variable to select local or Cloudflare OCR.
[ADR 0011](0011-cloudflare-vision-ocr-evaluation-adapter.md) made Cloudflare an
injectable adapter, but the backend always constructed local Tesseract. Sharing
one evaluation adapter across a worker would exhaust its single-request allowance
after the first book. Merely making new instances could also repeat paid calls
when a stage fails after a successful response or a worker restarts.

## Decision

Use OCR_PROVIDER=local|cloudflare, default local. Reject unknown values. Build the
ingestor before Firebase initialization so malformed provider settings fail startup.
Cloudflare selection is accepted only in the emulator runtime, with an explicit
CLOUDFLARE_OCR_APPROVED=true and injected token/account values. API-only processes
never construct hosted OCR clients or require their credentials. Production and
cloud-runtime selection remain blocked regardless of the development approval flag.

Restrict hosted ingestion to the SHA-256 values of the four committed owned test
PDFs. This scope is enforced in code, not inferred from an upload filename or the
operator's declaration. Each PDF uses a fresh client, retaining the Arabic-only,
one-OCR-page and response bounds. English text-bearing fixtures still use their
text layers without an OCR call. No implicit local fallback follows hosted failure.

Require a persisted pre-send attempt marker on the existing generation job. Check
family/kid state, job stage, status, lease and fence transactionally before marking
it. Refuse an already marked job after process restart or downstream failure.
All OCR errors are terminal rather than automatically retried. A shared in-process
request allowance defaults to one and accepts only 1–4 attempts per worker lifetime;
failed or indeterminate attempts consume the allowance. Numeric token and estimated
cost metadata remain in extracted stage state, without logging source content.

The default Docker worker retains its private network. An explicit development
Compose overlay supplies only the worker with Cloudflare settings and outbound
connectivity. Secrets are injected at runtime; no client or image gains a key.
No live request is part of implementation verification.

## Alternatives

Keeping a provider variable that always rejects cloudflare does not fulfill the
requested switch. Enabling arbitrary family uploads was rejected because processor,
residency, consent and durable monetary budget decisions remain incomplete.
Removing the one-page limit or adding automatic paid retries requires separate
quality, lease-duration and spending decisions. Automatic fallback would conceal a
provider failure and make extraction behavior unpredictable.

## Consequences

This makes the existing synthetic development workflow configurable; it does not
approve production or real family data. The job marker bounds duplicate attempts,
not account-wide dollar spending. Restarting permits fresh jobs to consume a new
process allowance. Production still needs durable budget reservation/reconciliation
and resolution of the existing image-deletion/cloud-transport issues. A job marked
before an interrupted send may fail without spending; conservative refusal avoids
an uncertain second billable request.

## Verification

Mocked tests cover defaults, invalid settings, missing credentials, API-only roles,
owned-source hashes, per-book clients, shared quotas, plaintext bypass, terminal
failures, persisted duplicate refusal after worker restart and deletion/fence/lease
checks. Full repository checks run with synthetic fixtures and isolated emulators.
No new provider call or download is needed.

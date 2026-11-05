# Cloudflare vision OCR

The backend selects OCR through **OCR_PROVIDER=local|cloudflare**, defaulting to
local Tesseract. Restart the backend after changing the value. Unknown values fail
startup. Cloudflare is available only for the owned synthetic PDFs in emulator
mode; cloud/production family processing remains blocked. See [ADR 0012](decisions/0012-selectable-ocr-for-owned-synthetic-development.md).

## Backend switch

Local (also the default when unset):

```sh
OCR_PROVIDER=local npm run dev
```

For a separately approved, potentially billable synthetic run, inject
CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID into the backend process, then:

```sh
OCR_PROVIDER=cloudflare CLOUDFLARE_OCR_APPROVED=true CLOUDFLARE_OCR_MAX_REQUESTS=1 npm run dev
```

The entrypoint reads process environment variables; these commands do not load a
file automatically. Do not paste keys into chat or commit them. Agent access to
secret files remains prohibited. The approval flag records the operator's decision
for this development run; it does not grant production or family-data approval.
API-only processes do not need Cloudflare credentials; the worker performs OCR.
Generation continues to use mocked AI regardless of the OCR provider.

The Cloudflare runtime accepts only the exact committed counting.pdf, addition.pdf,
arabic-counting.pdf and arabic-counting-scanned.pdf bytes, checked by SHA-256.
Unknown or modified uploads fail before transport. Only Arabic OCR is supported;
English text-bearing PDFs bypass OCR. The current allowance remains one OCR page
per book. Each book gets a fresh client, while the worker shares a request cap of
1 by default, configurable from 1 through 4. Restarting resets the process cap, but
a job's persisted attempt marker prevents a second send for the same job.
New jobs are separate attempts. This is not account-wide monetary budget enforcement.

Docker keeps the default worker network private. For the explicitly approved
synthetic run, use the optional overlay, with credentials already injected into
the shell environment:

```sh
OCR_PROVIDER=cloudflare CLOUDFLARE_OCR_APPROVED=true docker compose --env-file /dev/null -f compose.yaml -f compose.cloudflare.yaml up --build -d --wait
```

This overlay supplies credentials and outbound connectivity to the worker only.
Changing OCR_PROVIDER back to local selects Tesseract; omit the overlay to restore
the default network isolation. No image rebuild embeds credential values.

## Evidence and pricing

The user ran one direct vision request on the owned vocalized Arabic PNG using
`@cf/google/gemma-4-26b-a4b-it`. The [original result](evidence/cloudflare-vision.json)
is preserved from evaluation commit `73df8f8`; this change made no additional paid
calls. It took 15,011 ms, used 366 input and 636 output tokens, and achieved zero
base-letter CER after normalization. CER with vowel marks retained was 0.06321839.
That metric measures edits across letters, numbers and retained marks together;
it is not the error rate for diacritics alone. Punctuation and whitespace are not
scored. The model changed several vowel marks and shaddas. One short, clean page
does not establish accuracy on dense pages, tables, mixed languages or photographs.

The versioned `ocr.ar.v1` prompt preserves the exact instruction string used in that
request. It asks for literal transcription, including source mistakes, and treats
image instructions as untrusted text. This is not proof against prompt injection.
The original live test exercised its standalone harness, not the new adapter;
adapter transport, PDF integration and failure handling are verified with mocks.

Cloudflare currently lists [$0.10 per million input and $0.30 per million output
tokens](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
(checked 2026-11-05). The observed token counts imply **$0.0002274 per page**, or
about **$0.23 per 1,000 similar pages**, before any free allocation. This is an
estimate, not account billing evidence or a per-page price guarantee. Token counts,
pricing, retries and document complexity change costs. Lesson generation is extra.

## Bounds and failure behavior

- Arabic only, one OCR page per PDF and one attempted request per adapter instance.
  Reject a PDF exceeding the allowance before rasterization or a hosted call.
- PNG input at most 1,000,000 bytes and 2,400 pixels per side; header checks do not
  fully decode the image. PDF rasterization remains local and bounded.
- Fixed model, endpoint and versioned prompt. No tools, arbitrary URLs, fallback
  models or caller-supplied instructions. Non-streaming request with `store:false`,
  120-second timeout and redirect rejection. Provider retention and residency still
  require review; `store:false` alone is not a compliance guarantee.
- At most 2,048 completion tokens, 2 MB streamed response, 20,000 transcription
  characters. Require `finish_reason=stop`, nonempty text and valid token usage.
  Reject truncation, tool output and credential echoes. Errors expose fixed codes,
  never upstream bodies, request payloads or transport details.
- No automatic retries or local fallback after hosted failure. An indeterminate
  attempt consumes the instance allowance. Successful PDF results include page,
  provider, model, prompt version, token counts and estimated cost metadata.

These are evaluation request bounds, **not persisted production spend enforcement**.
The worker transactionally marks each job before its hosted request, checking active
family/kid state, stage, lease and fence. Marked jobs cannot send again after a crash,
downstream failure or restart. OCR errors are terminal. Missing usage/failed sends
retain the marker. This does not reserve dollars from a generation-job budget;
production still needs worst-case monetary reservation/reconciliation. The standalone
image evaluator uses its output-file claim rather than the pipeline job marker.

## Running the synthetic evaluation

From the repository root:

```sh
npm run eval:ocr:cloudflare
```

Default is offline dry run: no credentials, network or downloads. The live path
accepts only the exact committed `arabic-counting-vocalized.png`, checked by SHA-256.
It accepts no file, URL or model arguments. Inject `CLOUDFLARE_API_KEY` and
`CLOUDFLARE_ACCOUNT_ID` into the runtime without exposing them to agents or logs.
After explicit approval for a new potentially billable request:

```sh
npm run eval:ocr:cloudflare -- --live
```

It exclusively claims `.cache/cloudflare-ocr-evaluation.json` **before** transport,
blocking concurrent or repeated invocations. A failed or interrupted attempt leaves
its claim; review the result and approve further spend before manually removing it.
The synthetic report contains the transcription and numeric metadata only.
The agent does not read `.env` files. The repository hook previously required the
user to run credential-injected commands themselves.

## Verification and remaining decisions

Offline tests cover fixed routing, output/token/byte bounds, truncation, credential
echoes, concurrency, failed-attempt accounting, fixture integrity, report claims,
PDF page preflight, local scanner ordering, image refs and temporary-file cleanup.
The two-book mocked generation evaluation remains unchanged: schema, answer,
grade and private-draft checks pass at zero synthetic cost. Those checks do not
measure real OCR or teaching quality.

Initial adapter verification on 2026-11-05: lint, `check:fast` (14 Node and 151 Vitest tests),
fixtures, mocked prompt evaluation, backend/site/mobile player builds, and all
eight browser tests passed. The full `npm run check` command stopped at rules
emulator startup because the development stack occupied ports 9099/8080/9199.
All three rules/vertical tests then passed using a separate local stack on
19099/18080/19199, with its hub and logging on 14400/14500. Tests now honor
explicit emulator endpoints while rejecting non-loopback targets. The existing
development stack was left running. No new live OCR request was made. The later
full integration check passed with 21 Node tests, 151 unit tests, eight browser
tests and three emulator tests; see the integration review in [verification.md](verification.md).

Before family use: approve processor terms, region, retention and parent notices;
add persisted per-job monetary spend reservations; check cancellation,
lease fencing and family deletion before sends and writes; review routing policy;
then evaluate a broader owned corpus with parent-review expectations. Existing
family consent records do not grant new processor approval. Deployment and live
family-data processing remain gated separately.

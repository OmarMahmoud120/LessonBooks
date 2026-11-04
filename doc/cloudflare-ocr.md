# Cloudflare vision OCR

Cloudflare Gemma vision is an **evaluation-only backend adapter**, injectable into
`PDFIngestor`. The API and worker still instantiate local Tesseract. Setting
`OCR_PROVIDER=cloudflare` fails startup in emulator and cloud modes. Credentials
alone never select the hosted provider. No family uploads are authorized for it.
See [ADR 0011](decisions/0011-cloudflare-vision-ocr-evaluation-adapter.md).

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
The adapter does not reserve from a generation-job budget. Creating a new instance
in another process can spend again. Production needs durable idempotency and
worst-case cost reservation/reconciliation, including failures and stage retries.

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

Verification on 2026-11-05: lint, `check:fast` (14 Node and 151 Vitest tests),
fixtures, mocked prompt evaluation, backend/site/mobile player builds, and all
eight browser tests passed. The full `npm run check` command stopped at rules
emulator startup because the development stack occupied ports 9099/8080/9199.
All three rules/vertical tests then passed using a separate local stack on
19099/18080/19199, with its hub and logging on 14400/14500. Tests now honor
explicit emulator endpoints while rejecting non-loopback targets. The existing
development stack was left running. No new live OCR request was made.

Before family use: approve processor terms, region, retention and parent notices;
add persisted per-job spend reservations and call idempotency; check cancellation,
lease fencing and family deletion before sends and writes; review routing policy;
then evaluate a broader owned corpus with parent-review expectations. Existing
family consent records do not grant new processor approval. Deployment and live
family-data processing remain gated separately.

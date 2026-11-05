# Cloudflare Markdown conversion evaluation

Tested: 2026-11-05 (Asia/Amman). Four live responses were inspected after the user
ran the command locally; the agent did not load credentials.
This evaluator is isolated from product ingestion and sends only four explicitly
listed repository-owned synthetic fixtures. No family uploads are selected.

## Run

Dry-run, without credentials or network access:

```sh
node backend/eval/cloudflare-markdown.mjs
```

The user supplies CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID in backend/.env.
Run locally from the repository root, using Node runtime secret injection:

```sh
node --env-file=backend/.env backend/eval/cloudflare-markdown.mjs --live
```

Do not paste credentials into chat or commit the environment file. The current
repository pre-tool hook blocks the agent's env-file invocation; it must not be
bypassed. No live request was made by the blocked invocation.

The command makes at most four sequential requests, with no automatic retries.
Image conversion may incur Workers AI charges. The runner claims the report before
transport and refuses existing or interrupted batches. Review evidence and obtain
new spend approval before deliberately clearing a report for another run. Actual billed cost is not supplied by this endpoint and must be checked in
the Cloudflare account. Stop on HTTP errors (including auth/rate limits), transport
errors, malformed or excessive output. A per-file conversion error is recorded
separately from a successful HTTP status.

## Cases and scoring

1. counting.pdf: one text-bearing English PDF with known reference text.
2. arabic-counting.pdf: owned text-bearing Arabic PDF; qualitative output inspection.
3. arabic-counting-scanned.pdf: owned image-only Arabic PDF; check whether any literal
   source text is recovered rather than assuming PDF format support implies OCR.
4. arabic-counting-vocalized.png: synthetic Geeza Pro 36px vocalized page rasterized
   at scale-to 2400, preserved from the earlier local OCR benchmark. Its reference is
   SENTENCES_VOCALIZED from backend/eval/ocr-eval-generate.mjs. The image was visually
   inspected before preparation; it contains four counting sentences only.

The evaluator reports normalized letter/number CER and a separate diacritic-aware
CER where exact references are available. It does not invent references for the two
Arabic PDF cases. Metadata is disabled and no translation or description-language
override is requested. This is a test of the documented default conversion path.
Markdown-only formatting is removed for scoring; added descriptions, omitted words,
and changed symbols still need manual inspection. CER can exceed 1 when much extra
text is generated. Two reference-scored pages cannot establish general OCR quality.

Results are saved in doc/evidence/cloudflare-markdown.json. Only fixture identifiers,
synthetic output, timing/status, token counts when supplied and metrics are retained.
Credentials are redacted defensively from output; headers and full provider error
bodies are never logged. Responses are capped at 2 MB and extracted text at 20,000
characters; each request has a 60-second timeout. Redirects are rejected.

## Verification

Eight mocked evaluator tests pass, covering multipart requests, per-file failures,
auth/throttle failures without retry, bounded responses, safe errors and scoring.
Lint and check:fast pass. No new dependency is needed. These checks do not prove
live conversion quality. Production integration and family-data processing remain
separate decisions after the actual outputs are reviewed.

## Live results

The user-run batch completed at 2026-11-04T21:31:31.960Z (2026-11-05 locally).
All four requests returned HTTP 200 and Markdown, but conversion success was not
transcription success:

| Fixture              | Time     | Observed result                                                                                                                   |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| English text PDF     | 323 ms   | Source sentence preserved exactly after removing converter headings. Corrected normalized letter CER: 0.                          |
| Arabic text PDF      | 372 ms   | Arabic extracted, with examples such as تفاحتني and ثالثة rather than intended تفاحتين and ثلاثة. No full-reference CER assigned. |
| Arabic scanned PDF   | 799 ms   | Filename, Contents and Page 1 headings only. No source text recovered.                                                            |
| Vocalized Arabic PNG | 7,609 ms | English image description and paraphrased content summary. No literal Arabic transcription.                                       |

The raw report is [cloudflare-markdown.json](evidence/cloudflare-markdown.json).
Its original English CER is 0.48 because the first scorer included Cloudflare's
filename/Contents/Page headings. Offline recalculation after removing that exact
known wrapper gives 0. The raw report is preserved; the evaluator and its regression
test now remove that wrapper for future runs. No additional API call was needed.
The image's original CER above 1 measures an English description against Arabic
reference text; it is not a useful OCR-quality percentage. The decisive observation
is that no literal Arabic transcription was returned.

Conclusion: this endpoint is useful to evaluate for text-bearing document conversion,
but this four-case test rejects its default conversion path as our scanned-Arabic OCR
replacement. It confirms the documented split between PDF text extraction and image
description. This batch tested no alternative prompt/model options or direct vision endpoint.
The separate [direct vision experiment](cloudflare-vision-test.md) and
[bounded OCR adapter](cloudflare-ocr.md) preserve the follow-up work.
No claim is made about Cloudflare's other AI models or OCR services. No family data was
sent. Actual billing was not returned and has not been verified in the account dashboard.

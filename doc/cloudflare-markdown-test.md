# Cloudflare Markdown conversion evaluation

Prepared: 2026-11-05. A live run completed on 2026-11-04T21:31:31Z against four
repository-owned synthetic fixtures. This evaluator is isolated from product
ingestion and sends only those explicitly listed fixtures. No family uploads are
selected.

## Run

Dry-run, without credentials or network access:

```sh
npm run eval:markdown
```

The user supplies CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID in backend/.env.
Run locally from the repository root, using Node runtime secret injection:

```sh
node --env-file=backend/.env backend/eval/cloudflare-markdown.mjs --live
```

Do not paste credentials into chat or commit the environment file. The current
repository pre-tool hook blocks the agent's env-file invocation; it must not be
bypassed. The recorded live run was performed by the user outside the agent
session.

The command makes at most four sequential requests, with no automatic retries.
Image conversion may incur Workers AI charges. Run it once; rerunning starts a new
batch. Actual billed cost is not supplied by this endpoint and must be checked in
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

## Live results

Four of four requests returned HTTP 200 in 9.1 seconds total; no request stopped the
batch and no retry occurred.

| Fixture                       | Result                          | Interpretation                                                                                                                                                                       |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| counting.pdf                  | text recovered, letter CER 0.48 | The lesson text matches the reference exactly once the generated filename/Contents/Page headings are removed; the whole reported error is formatting noise, not missing source text. |
| arabic-counting.pdf           | text recovered, no reference    | The full three-sentence Arabic lesson is present. Headings are still injected.                                                                                                       |
| arabic-counting-scanned.pdf   | empty output                    | Image-only PDFs are not OCRed. The endpoint returned success with no literal source text.                                                                                            |
| arabic-counting-vocalized.png | English description, CER 8.37   | The model returned an image description instead of the Arabic transcription. No literal source text was reproduced.                                                                  |

Conclusion: the default `tomarkdown` path is a formatting converter for
text-bearing documents, not an OCR or transcription service. It is unsuitable as a
replacement for the pinned local OCR pipeline, and it would inject extra headings
and descriptions into grounded source text. No product ingestion path should call
it. Re-testing would require different request options and a new explicit decision;
the current evidence does not justify that work.

## Verification

Six mocked evaluator tests pass, covering multipart requests, per-file failures,
auth/throttle failures without retry, bounded responses, safe errors and scoring.
The live evidence above is synthetic-only and was not produced by the agent.
Lint and check:fast pass. No new dependency is needed. Production integration and
family-data processing remain separate decisions and are not approved.

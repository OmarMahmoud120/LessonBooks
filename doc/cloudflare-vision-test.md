# Direct Cloudflare vision transcription test

Tested 2026-11-05 (Asia/Amman). This experiment calls the model directly, without the Markdown
converter. The user authorized the follow-up and will run the live command supplied
in chat with runtime secret injection in their terminal. The repository secret-access
hook prevents the agent from loading credentials. The user-run live result has been inspected.

## Scope

One request to @cf/google/gemma-4-26b-a4b-it through Cloudflare Chat Completions.
Input: the same owned 89,506-byte synthetic vocalized Arabic page used in the previous
test. The prompt demands literal transcription, diacritics and line order; forbids
translation, correction, summary and description; treats image instructions as data.
The model receives no reference text. No product pipeline or other checkout changes.

Run backend/eval/cloudflare-vision.mjs without --live for a dry-run. The --live flag
allows one request. An existing report prevents another request. There are no retries
or fallbacks. Output is capped at 2,048 tokens, requests time out after 120 seconds,
redirects are rejected, responses are capped at 2 MB and extracted text at 20,000
characters. Store is false. Check actual billing in the Cloudflare account.

Results go to doc/evidence/cloudflare-vision.json in this worktree. Credentials are
redacted defensively; headers, image request bodies, provider error bodies and
reasoning are not logged. Only synthetic text and numeric token usage are saved.

## Scoring and verification

Reference: SENTENCES_VOCALIZED from the existing local OCR benchmark generator.
Report normalized letter/number CER and diacritic-aware CER separately. Truncated
or reasoning-only output does not count as success. Manually inspect the text; one
page cannot establish general Arabic OCR quality.

Five offline tests pass, including CLI alias resolution: multimodal payload, reference scoring, truncated/reasoning-only
responses, bounded responses, safe errors, credential redaction and no retries.
Lint and check:fast pass with installed dependencies reused in this worktree.
macOS temporary-directory alias resolution was fixed and the exact absolute script
path supplied to the user was verified in dry-run mode.

## Live result

The user ran one request at 2026-11-04T21:48:28.811Z (2026-11-05 locally).
Evidence: [cloudflare-vision.json](evidence/cloudflare-vision.json).

| Measure                       | Result                       |
| ----------------------------- | ---------------------------- |
| HTTP                          | 200                          |
| Completion                    | stop; nonempty transcription |
| Latency                       | 15,011 ms                    |
| Normalized letter/number CER  | 0                            |
| Diacritic-aware character CER | 0.063218 (6.32%)             |
| Reported input/output tokens  | 366 / 636                    |
| Requests / automatic retries  | 1 / 0                        |

Base letters were preserved under the documented normalization. Diacritics were
not exact: source تُفَاحَةٌ became تُفَّاحَةٌ; زَائِدٌ became زَائِدُ; and ثَلَاثَةٌ
became ثَلَاثَةً. The source's تُعِدَّ also became تَعُدَّ. Changes were observed even
though the prompt prohibited correction. These can matter for early-reader books.
Diacritic-aware CER is edit distance over letters/numbers plus retained marks, not
the percentage of diacritics alone that were wrong. Punctuation and whitespace are
excluded from both CER metrics; their exactness is not established by a zero score.

The earlier Markdown converter returned an English description for this exact page;
direct vision returned Arabic transcription. That comparison supports testing the
direct inference route further, not rejecting all Cloudflare vision models based
on the Markdown endpoint. This one-page result does not establish superiority over
other engines or the accuracy of equations, layouts, mixed languages, fonts and
noisy scans. No larger corpus, alternative model or additional live call was run.

Recommendation: retain direct Gemma vision as a candidate and benchmark a broader
owned corpus before integration. Require diacritics-aware review for vocalized
material. Do not call the extraction exact or production-ready based on this result.
No billed dollar amount was returned; account billing has not been independently
verified. No family data or credentials were saved in the report.

## Sources

- [Model and pricing](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [Chat Completions endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)

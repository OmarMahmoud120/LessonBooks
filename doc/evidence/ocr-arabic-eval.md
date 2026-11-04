# Arabic OCR quality evaluation — 2026-11-04

Evidence for the tiered OCR strategy in ADR 0010. Reproduce with `npm run eval:ocr`
(generates pages with headless Chrome on the host, recognizes them in the ephemeral
worker container with the same pinned models as production; local binaries only, no
AI calls or family data).

## Setup

20 synthetic A4 pages: 4 Arabic counting sentences (the same vocabulary as the owned
fixtures) across three fonts (Geeza Pro, Al Bayan, Waseem), three sizes (24/36/60 px)
and two vocalization levels (bare and fully vocalized), plus two mixed Arabic/English
pages. Each page was rasterized at scale-to 1800 and 2400 and recognized with
`--oem 1 --psm 3` by both the pinned tessdata_best `ara` model (with `+eng`) and the
tessdata_fast `ara` model as baseline: 76 recognition runs. Score is letter-level
character error rate (CER) after the production normalization (NFKC, tatweel strip,
non-letter removal) on both reference and hypothesis.

## Results

| Slice                | Letter CER                                    |
| -------------------- | --------------------------------------------- |
| Overall mean         | 0.618                                         |
| tessdata_best        | 0.641                                         |
| tessdata_fast        | 0.593                                         |
| Scale 1800           | 0.595                                         |
| Scale 2400           | 0.641                                         |
| Bare text            | 0.453                                         |
| Vocalized text       | 0.783                                         |
| Mixed Arabic/English | 0.468                                         |
| By font              | Al Bayan 0.486, Geeza Pro 0.651, Waseem 0.712 |
| By size              | 24px 0.554, 36px 0.573, 60px 0.735            |

The mean hides a bimodal distribution. Clean bare pages in suitable fonts can be
near-perfect: Al Bayan 36px bare at 1800 reads essentially correctly (~2–3% CER with
punctuation spacing artifacts). Vocalized pages collapse instead: `--psm 3` returns
empty output for Geeza Pro vocalized pages (CER 1.0); forcing `--psm 6` recovers
output but heavily degraded ("تفاحتين" recognized as "تفا حدين", harakat mangled,
spurious Latin/garbage lines).

## Findings

1. Fully vocalized Arabic — the norm in early-reader children's books — is unusable
   with Tesseract at any tested segmentation mode. Tier 1 therefore works as a
   fallback plumbing layer, not a quality solution, exactly as recorded in ADR 0010.
2. On clean renders the fast model slightly beat the best model (0.593 vs 0.641), so
   model choice is secondary to the engine's fundamental limits here. The pinned best
   models stay for reproducibility but this removes any claim that they are the
   accurate option.
3. The production scale-to 2400 for Arabic scored worse than 1800 (0.641 vs 0.595)
   on this corpus; if Tesseract remains in any path, scale deserves re-tuning, but
   tuning will not change the vocalized collapse.
4. Small Latin-English content inside mixed pages degraded the Arabic result for the
   `ara`-only baseline; mixed books need explicit per-page language handling, which
   the per-page script detection from tier 1 already records.

## Consequence

Proceed to tier 2 (Surya sidecar per ADR 0010) before relying on OCR for real Arabic
books; its license confirmation and model downloads are the remaining decisions. Tier
1 stays valuable for text-bearing PDFs of Latin-script books, bounded fallback and
the language plumbing it introduced.

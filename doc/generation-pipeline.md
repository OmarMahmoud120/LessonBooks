# Generation pipeline

Development agents in .agents are distinct from product generation prompts in backend/prompts.

| Stage         | Typed input → output                                                   | Failure policy                                                                   |
| ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ingest        | private quarantined PDF → bounded extracted pages/images and language  | reject malformed/oversize/encrypted input; scan before parser; OCR scanned pages |
| structure     | extracted content → chapters/topics with source references             | bounded model retry                                                              |
| plan          | topics + curriculum/age/language/reading level → 3–5 lesson outlines   | reject unsupported curriculum/capabilities                                       |
| generate      | outline + source excerpts → one structured lesson JSON                 | bounded generation attempts                                                      |
| validate      | lesson → schema, answer consistency, reading-level and safety findings | bounded repair/regeneration; fail closed                                         |
| publish       | validated lesson → immutable private artifact + draft record           | idempotent transaction and storage refs                                          |
| parent review | draft revision → approved revision                                     | authenticated parent only                                                        |

Every transition persists status/progress, attempt count, lease fence, policy/model/prompt/schema versions and sanitized error code. Claim stages transactionally; stale claims cannot commit. Recover lost dispatch via a persisted outbox. Duplicate tasks must not duplicate lessons or costs. Check cancellation and parent/kid tombstones before calls and publication.

Decision model: receives stage, locale, capability needs, bounded complexity metadata and remaining budget; returns a route ID from a configured allowlist. The policy validator decides whether it is permitted. Book text cannot alter models, tools, provider preferences or budget. Do not give generation models tools, credentials, arbitrary URL fetches or executable capabilities. Untrusted source content is clearly separated from instructions; validation is still required because separation does not eliminate prompt injection.

OpenRouter requests use structured JSON output where supported. Require parameter support and pin approved provider routing; no hidden provider fallback outside policy. Validate responses locally regardless of provider guarantees. Log token counts, actual/estimated cost, route and retry information without book text or profile data. Reserve worst-case cost before a call, reconcile usage after it, and include the decision model in the budget. Live mode fails configuration validation until provider/region/budget approvals exist.

Prompts: versioned Markdown files with declared inputs; substitute data through JSON serialization, never string concatenation into system instructions. Offline evaluation uses synthetic/owned sample books, rubric checks for validity, source grounding, objective fit, reading level, answer consistency and safety. Mocked evaluation proves plumbing and regressions, not actual model quality. Before/after reports record prompt versions and rubric differences. Paid evaluations need explicit authorization.

Phase 1 supports review/approval. Editing, feedback-driven regeneration and assignment UX remain later phases. Baseline safety checks and deletion are not deferred.

Implemented: six exported typed stage functions, persisted stage attempts and fences, mocked decision routing, schema/answer checks, and a separate repair_count limited to two regeneration transitions on quality rejection. Actual model quality, language identification beyond the initial heuristic, source-image extraction and production moderation are unverified. The evaluation harness runs two owned digital PDFs across both grades through deterministic mocks; real-model and before/after comparison reports are still pending.

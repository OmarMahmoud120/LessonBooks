# Data model and access matrix

Canonical family root: parents/{parentId}. The identity-provider subject (`sub`) is
the parentId: the Keycloak user id. Subcollections below that root: kids, books,
generation_jobs, lessons, consent_records, assignments and progress_events.
lesson_results has no writer yet.

| Entity                 | Principal fields                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| parent                 | id, preferred_language, country, state, created_at; email remains in Auth unless needed                                          |
| kid                    | id, nickname, preset avatar, age_band, country, language, curriculum_id, grade_id, reading_level, state                          |
| book                   | id, kid_id, subject, language, source refs, sha256, status, created_at                                                           |
| job                    | id, book_id, kid_id, stage, progress, attempts, lease/fence, error_code, model/prompt/policy versions, usage, budget reservation |
| lesson                 | id, book_id, kid_id, order, revision, schema_version, draft/approved/archived, summary, private storage ref                      |
| consent                | type, version, granted_at, parent_id, method, withdrawn_at if applicable                                                         |
| assignment (Phase 2)   | id, kid_id, lesson_id, revision, assigned_by, assigned_at                                                                        |
| event/result (Phase 2) | event_id, kid_id, lesson_id, revision, activity_id, type, score, max_score, duration_ms, client_at, received_at                  |

Use age bands, not birth years. Nicknames and educational progress are personal data even without direct identifiers. Do not collect photos, school names, location coordinates, voice recordings or contact information for children.

| Actor           | Own-family API                                             | Other family                           | Direct private Postgres/Garage | Public curriculum |
| --------------- | ---------------------------------------------------------- | -------------------------------------- | ------------------------------ | ----------------- |
| unauthenticated | deny                                                       | deny                                   | deny                           | read              |
| parent          | validated operations                                       | deny                                   | deny                           | read              |
| child profile   | no separate identity; Phase 2 restricted host capabilities | deny                                   | deny                           | through host      |
| API service     | scoped by verified UID                                     | no user-controlled cross-family access | private-network service access | read              |
| worker service  | only referenced active job/family                          | reject mismatched refs                 | private-network service access | read              |

No client has direct database or object-store access; the published ports bind to
loopback only and exist for verification and gated integration tests. API and worker
ownership tests are required to prove isolation. All referenced kid/book/job/lesson
IDs must resolve under the authenticated parent namespace.

Lesson status does not encode assignment; assignments are separate records. Approval pins an immutable revision. Deletion first marks family/kid deleting, rejects new work, cancels jobs, removes records and storage objects, then removes Auth on account deletion. Retry deletion safely; never allow a stale worker to resurrect data. Backup erasure deadlines and legal record retention need approval before launch.

Implementation note (2026-11-06): the operator audit log (ADR 0016) lives at the top-level `audit_log/` path in whichever document store is active and is NOT family-scoped: entries survive family and account deletion by design so deletions stay auditable. Entries carry the operator identity, action and opaque target identifiers (family/lesson/job IDs, counts) — never child profile content, lesson text or credential material — and are pruned on a bounded 400-day window. The browser OIDC session (site `auth.ts`) also sits outside the private namespace: localStorage holds the OIDC tokens and IdP profile claims, and a tab-scoped `lessonbooks-parent-unlocked` sessionStorage flag marks the PIN-unlocked parent tools; it holds no personal data and dies with the tab.
Implementation note (2026-11-05): queued play events live in a bounded browser localStorage queue (500 events, 50 per batch) and the lesson cache is best-effort local storage, so both are outside the private namespace and untrusted. The API derives kid identity from the stored lesson, rejects revision mismatches and duplicates by event_id, and never accepts a client-supplied kid_id. Clearing local storage loses undelivered events; the queue is not a durable server-side ledger.

Implementation note (2026-11-04): deletion erases family collections/assets before removing Auth, then retains a minimal UID/state tombstone to reject already-authenticated in-flight requests. The local worker resumes roots marked deleting. Tombstone retention and any backup guarantees need legal review before live use.

Owned-fixture OCR development stores hosted_ocr_attempted on a generation job before
transport. This operational marker prevents duplicate hosted sends after a crash or
retry and is erased with the family's generation jobs. It adds no provider-visible
profile data. Token/cost metadata remains scoped to extracted stage state; the flag
is not evidence of a reserved monetary budget. See ADR 0012.

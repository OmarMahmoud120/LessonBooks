# Data model and access matrix

Canonical family root: parents/{parentId}. The Firebase Auth UID is the parentId. Subcollections below that root: kids, books, generation_jobs, lessons, consent_records and (later) assignments, progress_events, lesson_results.

| Entity                 | Principal fields                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| parent                 | id, preferred_language, country, state, created_at; email remains in Auth unless needed                                          |
| kid                    | id, nickname, preset avatar, age_band, country, language, curriculum_id, grade_id, reading_level, state                          |
| book                   | id, kid_id, subject, language, source refs, sha256, status, created_at                                                           |
| job                    | id, book_id, kid_id, stage, progress, attempts, lease/fence, error_code, model/prompt/policy versions, usage, budget reservation |
| lesson                 | id, book_id, kid_id, order, revision, schema_version, draft/approved/archived, summary, private storage ref                      |
| consent                | type, version, granted_at, parent_id, method, withdrawn_at if applicable                                                         |
| assignment (Phase 2)   | kid_id, lesson_id, approved_revision, assigned_by, assigned_at                                                                   |
| event/result (Phase 2) | event_id, kid_id, lesson_id, revision, activity_id, type, score, duration_ms, client_at, received_at                             |

Use age bands, not birth years. Nicknames and educational progress are personal data even without direct identifiers. Do not collect photos, school names, location coordinates, voice recordings or contact information for children.

| Actor           | Own-family API                                             | Other family                           | Direct private Firestore/Storage | Public curriculum |
| --------------- | ---------------------------------------------------------- | -------------------------------------- | -------------------------------- | ----------------- |
| unauthenticated | deny                                                       | deny                                   | deny                             | read              |
| parent          | validated operations                                       | deny                                   | deny                             | read              |
| child profile   | no separate identity; Phase 2 restricted host capabilities | deny                                   | deny                             | through host      |
| API service     | scoped by verified UID                                     | no user-controlled cross-family access | IAM server access                | read              |
| worker service  | only referenced active job/family                          | reject mismatched refs                 | least-privilege IAM              | read              |

Admin SDK bypasses rules. API and worker ownership tests are required; rules tests alone do not prove isolation. All referenced kid/book/job/lesson IDs must resolve under the authenticated parent namespace.

Lesson status does not encode assignment; assignments are separate records. Approval pins an immutable revision. Deletion first marks family/kid deleting, rejects new work, cancels jobs, removes records and storage objects, then removes Auth on account deletion. Retry deletion safely; never allow a stale worker to resurrect data. Backup erasure deadlines and legal record retention need approval before launch.

Implementation note (2026-11-04): deletion erases family collections/assets before removing Auth, then retains a minimal UID/state tombstone to reject already-authenticated in-flight requests. The local worker resumes roots marked deleting. Tombstone retention and any backup guarantees need legal review before live use.

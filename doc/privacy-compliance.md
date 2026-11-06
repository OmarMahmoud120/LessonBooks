# Privacy and compliance

This is an engineering design aid, not legal advice or a claim of compliance. No real family data or public launch is authorized yet. Confirm jurisdiction, legal basis, consent method, processing regions, vendor terms and retention before enabling live use.

| Data                                                           | Why collected                        | Proposed handling                                    |
| -------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Parent email / Auth subject                                    | account authentication and ownership | Keycloak or Firebase Auth; avoid duplicating email   |
| Consent type/version/time/method                               | document parental choices            | server timestamps; withdrawal supported              |
| Nickname, preset avatar, age band, grade, curriculum, language | adapt lessons                        | no DOB, photo, school name or contact fields         |
| Uploaded book and extracted content                            | produce lessons                      | private quarantine and processing storage            |
| Lesson drafts/approval                                         | parent review and rendering          | family-scoped immutable revisions                    |
| Job token/cost/error metrics                                   | operate and bound generation         | no raw book text, answers, tokens or secrets in logs |
| Progress (Phase 2)                                             | learning history                     | minimized events; no third-party analytics SDK       |

Nicknames and progress remain personal data. Uploads may themselves contain identifying information; minimize/redact before model processing and explain this to parents. No advertising, behavioral tracking, public library, child accounts or audio recording. Read-aloud text does not require collecting a child's voice.

Development retains synthetic fixtures only. Proposed production retention must be approved: quarantine/rejected uploads short-lived; originals/extracted intermediates removed after generation unless needed for an explicitly agreed purpose; lessons retained until parent deletion; operational logs short-lived and scrubbed. Numeric TTLs, inactive-account cleanup, backup expiry and deletion SLA are open launch decisions, not silently chosen defaults.

Deletion: authenticated parent can delete a child or account. Mark deleting and cancel jobs first, erase all related uploads/intermediates/lessons/events and revoke access, then remove Auth for account deletion. Retry failures without resurrecting data; include provider retention and backup limitations in the user-facing policy. Require recent authentication for account deletion.

Consent capture alone is not verifiable parental consent. [FTC guidance](https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy) describes COPPA coverage and consent obligations; counsel must assess applicability and an appropriate method. EU GDPR/children's rules and the UK Children's Code also require jurisdiction-specific review; age thresholds and legal bases must not be generalized globally. ICO and EUR-Lex pages could not be retrieved in this research session, so their requirements remain unverified here.

Pre-launch review: lawful basis and child-facing notices; parental verification; data-protection impact assessment; minimization/retention; data-subject access and erasure; cross-border transfers; GCP/OpenRouter/downstream provider agreements and logging; incident handling; security monitoring; processor deletion; copyright/upload rights and terms. Budget and data-region decisions are required before live model calls. Safety filtering plus parent review reduces risk but does not guarantee age appropriateness.

Local implementation retains only an account UID/deleted-state tombstone after erasure to prevent stale authenticated requests from recreating accounts. This remains personal data; its lawful basis and retention must be settled before launch. Temporary mobile PDF copies are cleared from the app-private picker cache at startup and before/after upload attempts. Android recovery of seeded interrupted-copy residue is verified; native iOS and real crash timing remain unverified. See [upload-copy recovery](upload-cache-cleanup.md). Cleanup requires another app launch if the process terminates before finally runs.

# Lesson schema

Source of truth: doc/specs/lesson; generated TypeScript lives in doc/contracts/generated and is never edited manually. Events are independently versioned under doc/specs/events. The @lessonbooks/contracts workspace exports types and runtime validation to backend, site and mobile.

A lesson has an id, schema_version, metadata and ordered sections. Metadata carries title, subject, grade, age range, BCP-47 language, ltr/rtl direction, curriculum references, reading level, estimated minutes and objectives. Strings support locale maps with an explicit lesson locale; avoid guessing direction from string content.

Blocks: text, image with alt text, read-aloud text/audio, vocabulary, example and tip. Only plain text is rendered. Media uses validated asset references, never arbitrary executable markup or external navigation.

Activities share id, type, prompt, feedback, points, difficulty, optional media, and explicit answer data. Stable option/item IDs support localization. Scoring defines exact vs per-item partial credit, multiple accepted answers, normalization and maximum points. Do not award duplicate selections or match distractor text by array index.

Schema v1 documents ten variants. Phase 1 capability validation accepts only multiple_choice, true_false, fill_in_the_blank, drag_to_match and categorize. Unsupported variants must fail before publication and at player load. Fixtures include English, Arabic RTL and math-focused lessons using supported components.

Versioning: breaking required fields or semantics require a new major schema version; additive supported variants need capability negotiation and a documented version change. Reject unknown versions rather than guessing. Generate deterministically and fail CI on drift.

Future game shell: an optional versioned wrapper could describe theme, levels, lives and rewards independent of lesson correctness. No game shell runtime or arbitrary custom widgets in Phase 0/1.

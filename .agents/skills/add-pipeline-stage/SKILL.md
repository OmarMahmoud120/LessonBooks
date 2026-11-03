---
name: add-pipeline-stage
description: "Add or change a persisted asynchronous lesson-generation stage."
---

Read doc/generation-pipeline.md. Define typed inputs, outputs, transitions, idempotency key and cancellation/deletion behavior. Persist attempts, leases and bounded retries. Test duplicate delivery, transient/permanent failure and stale workers with a mocked AI client. Record usage and update the pipeline documentation. Run npm run check.

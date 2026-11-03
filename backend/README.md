# backend

Use doc/generation-pipeline.md, doc/data-model.md and doc/api.md. Never trust parent_id from input. Use mocked AI in tests and sanitize logs. Run npm run check:fast at root; backend build: npm run build --workspace @lessonbooks/backend.

Run commands from the repository root. See ../doc/milestones.md for current implementation status.

Configuration is documented in .env.example where applicable; do not put real secrets in source. Dependency installation requires approval.

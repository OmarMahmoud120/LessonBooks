---
name: change-prompt
description: "Revise or compare a versioned LessonBooks generation or routing prompt."
---

Read doc/generation-pipeline.md. Capture the mocked evaluation baseline before changing a prompt. Add a new version in backend/prompts, preserving previous versions. Keep book content separate from system instructions. Run npm run eval:prompts and record rubric differences, schema validity and synthetic cost. Mocked scores do not prove model quality. Live evaluation needs approved budget, data and network access.

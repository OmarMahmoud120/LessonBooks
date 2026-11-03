---
name: add-language
description: "Add a supported UI or lesson language to LessonBooks."
---

Read doc/lesson-schema.md and doc/activity-catalog.md. Externalize all strings in site and mobile locale resources. Specify BCP-47 locale, direction, font fallback and reading-level policy. Add lesson fixtures and keyboard/screen-reader tests in the new direction. Update prompt locale inputs; a translation fixture does not imply curriculum support. Run npm run check.

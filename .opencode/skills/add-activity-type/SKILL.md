---
name: add-activity-type
description: "Add or change a structured LessonBooks activity across contracts and the shared player."
---

Read doc/lesson-schema.md and doc/activity-catalog.md. Update the canonical schema in doc/specs, including scoring and localized text. Decide compatibility and bump the version when needed. Run npm run contracts:generate. Add the player component, keyboard/touch alternatives, LTR/RTL fixtures and scoring tests. Update capabilities so unsupported clients reject the type. Run npm run check and update the catalog.

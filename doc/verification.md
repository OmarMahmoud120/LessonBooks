# Verification — 2026-11-04

`npm run check` passed after the final code changes. It ran lint/format checks,
strict TypeScript, generated adapter/contract drift checks, eight agent-policy
and adapter tests, 22 unit tests, all three lesson fixtures, the two-book/two-grade
mocked evaluation, backend/site/player builds, eight Playwright tests and three
Firebase emulator tests.

Browser evidence includes English/Arabic RTL, desktop/mobile viewports, axe,
keyboard interactions, offline interaction after initial load, and the exact
bundled mobile player running under its CSP without unsafe-eval. The shared
contracts use generated standalone validators; runtime schema compilation is
backend-only.

The emulator vertical test uses actual Firebase Auth, Firestore and Storage:
an owned digital PDF becomes three private drafts, one revision is approved,
and child deletion removes lesson records and uploaded/generated storage objects.
Unit regressions cover duplicate worker delivery, bounded regeneration,
cross-family access, deletion resurrection and a worker finishing after deletion.

Offline Expo/Metro iOS JavaScript export also passed. This proves JavaScript
bundling, not native iOS/Android WebView execution or screen-reader conformance.

One independent security/privacy review produced actionable findings that were
fixed. Its follow-up hit the account usage limit. Full reviewer/native-agent
coverage is pending and is not inferred from scripted tests.

No paid model calls, real family data, MCP connections, pushes or deployments.
Remaining phase criteria and external decisions are recorded in milestones.md.

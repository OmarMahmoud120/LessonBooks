# Agentic setup

Portable source: root/local AGENTS.md, .agents/skills, .agents/agents, .agents/commands and backend/scripts/agent-policy.mjs. Existing caveman/ultracave skill directories are preserved. Lowercase .agents matches Codex discovery; no fictional universal .AGENTS/settings.json is used.

Run npm run agents:sync after shared role/skill/workflow changes; npm run agents:check checks deterministic adapter drift and behavior tests. Native files are generated adapters. New roles go in .agents/manifest.json plus a focused role file; new skills include name/description YAML and a narrow SKILL.md. Add tests for new enforcement behavior. Development agents are separate from backend/prompts product generation.

Eight skills cover activity, curriculum, language, pipeline stage, prompt, ADR, privacy and release changes. Seven roles cover schema, privacy, security, accessibility/RTL, pedagogy, tests and docs. Review roles are read-only. Seven workflow prompts cover plan-task, check, review, new-adr, add-activity, eval-prompts and phase-status. npm run workflow -- <name> exposes a portable entrypoint; prompt-only commands do not pretend to launch reviewers themselves.

| Adapter      | Native integration                                                 | Verification limits                                               |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Codex        | AGENTS.md, .agents/skills, .codex/config.toml roles and hooks      | Installed CLI; validate strict config; no paid CLI smoke sessions |
| Claude Code  | CLAUDE.md imports, .claude skills/commands/roles/settings          | CLI absent; static/adaptor tests do not prove native execution    |
| OpenCode v2  | AGENTS.md, opencode.json permissions/roles/commands, copied skills | Installed 2.1.3; v1 fields are intentionally not used             |
| Other agents | AGENTS.md and repository scripts                                   | Agent must honor its own sandbox/permissions                      |

Hooks: shared pre-tool policy blocks secret paths, traversal, symlink escapes, manual generated-contract edits and common destructive commands. Complex shell requires review; hooks are not a shell sandbox and cannot prevent every arbitrary interpreter bypass. After edits, run local formatter/linter without downloading packages. Stop runs fast tests/type checks and reports failures, with a repeat guard. Codex currently does not support a hook's permissionDecision=ask; its adapter reports the required approval and leaves native sandbox/approvals in force. This limitation is explicit, not equivalent to enforced per-command permission.

Package installs/downloads, network actions, MCP additions, paid calls, pushes and deployments require authorization. settings.local.json is ignored. Placeholder-only .env.example files are allowed; secret files are not. Generated contracts may only be written by the generator. User/workspace policy may be stricter than these files and takes precedence.

No MCP server is installed or configured. Candidates: GitHub for issues/PRs, Playwright for interactive debugging, official documentation lookup. Each needs separate approval and least-privilege credentials; CI/browser tests do not require MCP.

Official references checked 2026-11-03: [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skills](https://learn.chatgpt.com/docs/build-skills), [hooks](https://learn.chatgpt.com/docs/hooks), [configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [Claude hooks](https://code.claude.com/docs/en/hooks), [permissions](https://code.claude.com/docs/en/permissions), [subagents](https://code.claude.com/docs/en/sub-agents), [OpenCode v2 agents](https://opencode.ai/v2/docs/agents/), [permissions](https://opencode.ai/v2/docs/permissions/), [plugins](https://opencode.ai/v2/docs/build/plugins/server).

Do not copy permission shapes between tools. Verify supported events and fields before upgrading adapters. Native agent execution and independent reviews must be reported separately from scripted unit tests. The first doc-keeper invocation failed because the hosting account's subagent usage limit was reached; no review success is claimed.

OpenCode v2 uses a local dependency-free policy plugin for permission and after-edit hooks. A supported blocking stop hook was not established in the v2 documentation; run `/check` before completion. Claude CLI is absent. No native model-driven reviewer run has been claimed. The eight adapter tests exercise mock hook callbacks and CLI entrypoints, not provider inference.

2026-11-04 review evidence: an independent read-only security/privacy pass identified deletion resurrection, deletion recovery, stale mobile lesson responses, repeated invalid validation, and temporary upload retention. Fixes and backend regression tests were added. The follow-up review hit the account usage limit, so no independent re-verification is claimed.

Android CLI integration: the user-provided .agents/skills/android-cli/SKILL.md is
referenced from root and mobile AGENTS.md, so all agents can read the shared source.
Use android emulator/build/run/layout/screen with an explicit test-emulator serial.
No Android MCP server was added. Native results: android-native-test.md.

# LessonBooks

Private, parent-reviewed lessons generated from family-uploaded books.

Implementation is in progress. Start with [milestones](doc/milestones.md),
[architecture](doc/architecture.md), and [agent setup](doc/agentic-setup.md).

## Development

Node 24 LTS or newer, npm, Java 21+ for Firebase emulators, and platform tooling for
React Native are required. Ask before installing dependencies or downloading emulator
and browser binaries. No cloud project or API secret is needed for mocked development.

1. With approval, run `npm install` initially, or `npm ci` after the lockfile exists.
2. Run `npm run check:fast` for types, unit tests and development guardrails.
3. Run `npm run check` for the same checks as CI, including browser and emulator tests.
4. See each folder README for local startup instructions as its implementation lands.

No MCP servers, paid AI calls, production deployment or real family data are enabled.
The initial curriculum default is England / English / Years 1–2 / mathematics.
Arabic fixtures exercise RTL without claiming an Arabic curriculum launch.

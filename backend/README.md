# Backend

From the root, start `npm run emulators`, then `npm run dev`. The API listens on
127.0.0.1:3001 and verifies Firebase Auth emulator tokens. Firestore and Storage are
also emulator-only; the server refuses production or live-AI mode.

The local worker polls persisted jobs every 1.5 seconds. Each stage is an exported
function in src/stages.ts; pipeline.ts owns leases, attempts, cost reservations,
fencing and private publication. Model calls use a deterministic mock. OpenRouter
is an injectable backend adapter; provider/model configuration is passed as a
RoutingPolicy. It is not enabled by the local entrypoint.

Use synthetic PDFs in doc/fixtures/books. PDF.js runs in a worker with a 45-second
wall timeout and bounded JS heap. Scanned-page OCR requires locally provisioned
pdftoppm and English Tesseract. Antivirus is optional in the synthetic local demo;
required-scanner mode fails closed. OCR binaries, image extraction and scanner
operation have not been verified end to end. Never process real family books here.

Run `npm run check:fast`, `npm run eval:prompts`, and `npm run test:rules` from root.
`npm run build --workspace @lessonbooks/backend` checks/emits backend TypeScript;
production packaging, Cloud Tasks/OIDC dispatch and Cloud Run deployment are pending.
Secrets must be injected at runtime from Secret Manager; .env.example contains only
placeholders. Do not read local secret files into agent context.

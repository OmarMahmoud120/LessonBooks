# Backend

Start the local stack from root with `npm run docker:up` (Postgres, Keycloak,
Garage; see doc/docker.md), then `npm run dev`. The API listens on 127.0.0.1:3001
and verifies Keycloak access tokens against the realm JWKS. Documents live in
Postgres and private assets in Garage; the server refuses production or live-AI
mode.

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

Run `npm run check:fast` and `npm run eval:prompts` from root; `npm run docker:test`
covers the full stack journey. `npm run build --workspace @lessonbooks/backend`
checks/emits backend TypeScript; production packaging and the VPS deployment path
are pending (doc/vps-migration.md). Secrets must be injected at runtime on a VPS;
.env.example contains only placeholders. Do not read local secret files into agent
context.

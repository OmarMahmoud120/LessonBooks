# Backend and OCR Docker setup

## Local development

Requires Docker Engine and Compose with health-based dependencies and watch support.
Use synthetic/owned PDFs only. Initial builds download locked npm dependencies,
base images, emulator runtimes and Linux OCR/scanner packages. Startup downloads
ClamAV definitions through a separate updater. No host Node/Java/OCR installation
or cloud account is needed to run the stack.

```sh
npm run docker:up
npm run docker:logs
npm run docker:test
npm run docker:down
```

Without host npm:

```sh
docker compose --env-file /dev/null up --build -d --wait
docker compose --env-file /dev/null logs -f
docker compose --env-file /dev/null down
```

The empty env file prevents automatic loading of local .env files. The build context
uses an allowlist excluding private books, credentials, environments and native build
output. Images have no host source mounts. Use `docker compose --env-file /dev/null watch`
for source edit/rebuild on the running stack.

API: 127.0.0.1:3001. Auth/Firestore/Storage: localhost 9099/8080/9199. Existing web/mobile
clients use these ports; stop conflicting host services first. The worker exposes
health only on the private network. All AI is mocked.

The signatures job must finish successfully before worker startup. If the vendor
CDN rejects updates, startup fails closed. Inspect signatures logs and retry after
resolving the restriction; do not disable scanning to bypass it. Refresh explicitly:

```sh
docker compose --env-file /dev/null run --rm signatures
```

Emulator exports persist in lessonbooks_emulator-data on graceful shutdown. Scanner
definitions persist in lessonbooks_scanner-data. Normal down preserves both volumes.
Removing volumes erases local state; do so only intentionally after review.

## Runtime image packaging

```sh
docker build -f backend/Dockerfile --target api -t lessonbooks-api:local .
docker build -f backend/Dockerfile --target worker -t lessonbooks-worker:local .
```

API contains built JavaScript, versioned prompts, the mock lesson fixture and
production npm dependencies, without a TS loader, source tree, emulator CLI or OCR
tools. Worker adds pdftoppm/pdfimages, Tesseract with the pinned tessdata_best
Arabic and English LSTM models (sha256-verified download at build, see ADR 0010),
and clamscan/freshclam. Both run non-root. Compose uses read-only roots,
bounded temporary storage and read-only worker scanner definitions. The worker has only the internal network and cannot reach the internet. The updater
has a separate outbound network and no family-data access. API/emulators also use a
local bridge for host port publishing; that bridge permits outbound traffic.

These are production-shaped image artifacts, not an enabled production service.
Default NODE_ENV=production deliberately triggers the existing startup gate. Cloud
Tasks/OIDC/outbox, provider policy, regions, consent, retention, vulnerability review
and production Firebase configuration remain separate implementation/approval gates.
Do not deploy by setting NODE_ENV=development: that mode accepts emulator tokens only.

Runtime settings: SERVICE_ROLE api/worker/all (host default all), HOST
127.0.0.1/0.0.0.0, PORT 1024–65535, REQUIRE_SCAN true/false (Compose worker true).
Emulator endpoints accept only loopback or the exact Compose emulators service
with its expected port. Other destinations and live mode fail validation.

Cloud runtime mode (CLOUD_RUNTIME_APPROVED=true) requires NODE_ENV=production, an
explicit project, region (residency data), matching Cloud Tasks location and queue,
an https worker URL, a least-privilege worker service account, separate SERVICE_ROLE
values for api and worker, and forbids emulator endpoint variables. In cloud mode the
API enqueues generation tasks with deterministic idempotent names, runs an outbox
sweeper for lost dispatch and stalled leases, and the worker exposes
POST /v1/internal/jobs/:uid/:jobId that accepts only Cloud Tasks OIDC tokens for the
configured audience and service account; the poller is not used. Live AI stays
refused in both modes. Cloud Run service templates live in backend/infra/cloudrun/
and `npm run deploy` still fails by design until every decision in its checklist is
recorded. Dispatch and verification are tested with injected fakes only; real Cloud
Tasks delivery remains externally unverified.

## Verification

2026-11-04: All four targets build from the pinned digests; `docker compose up --build -d --wait`
reaches healthy api/worker with a completed signatures run. `npm run docker:test` passes the
synthetic auth → consent → owned PDF → scanned ingestion → approval → deletion journey with the
separated worker, and the native-tools smoke passes clamscan, rasterization and OCR in the
non-root worker container. First validation failed twice before passing: the smoke script posted
consents before the parent account existed, and the bundle read prompts plus the mock fixture
from paths the image did not package; both are fixed and covered by the passing runs.

## Optional Cloudflare OCR development

OCR_PROVIDER defaults to local on the worker. The optional compose.cloudflare.yaml
overlay injects Cloudflare settings and adds worker egress for explicitly approved,
owned-fixture evaluation. The API receives no Cloudflare credentials. Production
selection remains blocked, and the hosted path rejects unknown PDF hashes. See
[Cloudflare OCR](cloudflare-ocr.md#backend-switch) for commands, limits and approval
settings. The default compose.yaml keeps the worker on its private network.

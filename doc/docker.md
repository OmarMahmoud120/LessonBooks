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

API: 127.0.0.1:3001. Keycloak: 127.0.0.1:8081 (realm `lessonbooks`). Firestore/Storage
emulators: localhost 8080/9199; the Firebase Auth emulator still starts on 9099 for
the rollback path. Garage S3: 127.0.0.1:3900. Stop conflicting host services first.
The worker exposes health only on the private network. All AI is mocked, identity is
Keycloak and private assets are stored in Garage.

The signatures job must finish successfully before worker startup. If the vendor
CDN rejects updates, startup fails closed. Inspect signatures logs and retry after
resolving the restriction; do not disable scanning to bypass it. Refresh explicitly:

```sh
docker compose --env-file /dev/null run --rm signatures
```

Emulator exports persist in lessonbooks_emulator-data on graceful shutdown. Scanner
definitions persist in lessonbooks_scanner-data, and private assets persist in
lessonbooks_garage-data. Normal down preserves all three volumes. Removing volumes
erases local state; do so only intentionally after review.

## Private asset storage (Garage)

The Compose stack stores uploads, page images and intermediate job files in Garage,
a self-hosted S3-compatible store. MinIO was the original choice but withdrew its free
distribution; see [ADR 0014](decisions/0014-garage-replaces-minio-for-private-assets.md).

- The image is pinned by digest (`dxflrs/garage:v2.5.0@sha256:677e…a5a5`).
- Garage runs `server --single-node --default-bucket` with metadata and data under
  the `garage-data` volume. Startup creates the layout, access key and private
  `lessonbooks` bucket; `S3Assets.init()` is idempotent if the bucket already exists.
- Synthetic development credentials live in `compose.yaml` and can be overridden with
  `GARAGE_DEFAULT_ACCESS_KEY`, `GARAGE_DEFAULT_SECRET_KEY` and `GARAGE_DEFAULT_BUCKET`.
  They are local-only and must never be reused on a VPS.
- The API and worker reach Garage at `http://garage:3900` on the internal network.
  Only port 3900 is published, to loopback, for verification. The Garage console and
  admin API are not exposed, no anonymous bucket policy exists, and the API never
  returns object URLs.
- `backend/infra/garage.toml` contains a synthetic local RPC secret. A VPS deployment
  must generate its own secret, access keys and encrypted backups.

The Firebase Storage emulator still runs because Firestore remains the document
store; asset writes go to Garage under `ASSET_STORE=s3`. Setting
`ASSET_STORE=firebase` restores the legacy Cloud Storage adapter for comparison.

## Identity (Keycloak)

Compose runs Keycloak 26 with its own PostgreSQL database, on the private network
plus a loopback port for browsers.

- The realm, clients and one synthetic local parent are imported from
  `backend/infra/keycloak/realm-lessonbooks.json` on first start. The realm is only
  imported when it does not already exist; delete the realm through the admin API and
  restart Keycloak to re-import after editing the file.
- `lessonbooks-site` (website) and `lessonbooks-mobile` (app) are public clients using
  authorization-code + PKCE. They hold no secret. `lessonbooks-api` is a confidential
  service account used by the API only to delete identities. All credentials in the
  realm file and Compose are synthetic and local-only.
- The API verifies RS256 access tokens against the realm JWKS. `KEYCLOAK_ISSUER` is
  the browser-facing issuer that appears in tokens; `KEYCLOAK_BACKCHANNEL_URL` is the
  internal URL used for JWKS and admin calls. Neither is read from a token.
- Bootstrap admin: `local-admin` / `local-only-keycloak-admin`. The API never uses it.
- `npm run docker:test` creates a synthetic parent through the admin API, temporarily
  enables the password grant on the website client for scripted token acquisition,
  and disables it again afterwards. The browser flow uses PKCE, not that grant.
- Keycloak's `start` command auto-builds inside `/opt/keycloak`, so this local service
  cannot use a read-only root. A VPS image should bake `kc.sh build` and run
  `--optimized`.

## Switching identity back to Firebase

Set `AUTH_PROVIDER=firebase` (the default) and use Firebase emulator tokens again.
Firestore and the Firebase Auth emulator are untouched by the Keycloak path, so this
is the rollback path until Phase 6 removes it.

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
ASSET_STORE firebase/s3 (Compose uses s3); s3 requires S3_ENDPOINT, S3_BUCKET,
S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, and currently accepts only
`http://127.0.0.1:3900`, `http://localhost:3900` or `http://garage:3900`. Unknown or
missing values fail closed. Emulator endpoints accept only loopback or the exact
Compose emulators service with its expected port. Other destinations and live mode
fail validation.

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

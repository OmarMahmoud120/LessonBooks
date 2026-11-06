# 0014: Garage replaces MinIO for private assets

Status: Accepted
Date: 2026-11-06

## Context

[ADR 0013](0013-self-hosted-vps-deployment-replacing-firebase-and-cloud-tasks.md)
selected MinIO as the S3-compatible store for private family assets. While wiring
the local Compose stack, MinIO was no longer available through any free official
channel:

- `minio/minio` on Docker Hub denied the pull: the repository no longer exists there.
- `quay.io/minio/minio` denied anonymous registry access, and the registry API
  returned `UNAUTHORIZED` for anonymous pull tokens.
- The official community binaries under `dl.min.io` returned HTTP `410 Gone`.

Continuing with MinIO therefore requires a commercial AIStor licence and a spend
decision, which is outside this migration's approved scope. The code boundary is
unaffected: `S3Assets` depends on a narrow S3 transport, and bucket bootstrap uses
only `HeadBucket`, `CreateBucket`, `PutObject`, `GetObject`, `ListObjectsV2` and
`DeleteObjects`.

## Decision

Use **Garage** (`dxflrs/garage`, pinned by digest) as the self-hosted
S3-compatible asset store instead of MinIO.

- Garage is AGPL-3.0, available as a maintained container image, and designed for
  small self-hosted deployments. Both the store and the application remain
  self-hosted with no Google dependency.
- Single-node development uses Garage's `server --single-node --default-bucket`
  mode, which creates the layout, access key and bucket from environment values.
- The bucket stays private. Garage implements no S3 bucket ACL or policy API, and
  access is granted only through per-key bucket permissions; no anonymous policy is
  configured and no object URL is exposed by the API.
- The API and worker reach Garage over the internal Compose network. Only the S3
  port is published to loopback for local verification; the console and admin API
  are not exposed.
- A VPS deployment must generate its own RPC secret, access key and secret, keep
  them outside source control, and back up both the data and metadata directories.

The S3 adapter, asset paths, deletion behavior and family scoping are unchanged.

## Consequences

- No paid object-storage licence is required, and no MinIO image or binary is
  downloaded at build or run time.
- Garage does not support S3 bucket policies, ACLs, versioning or server-side
  encryption. Privacy relies on private-by-default buckets, network isolation and
  the API as the only data boundary; disk and backup encryption stay mandatory.
- Garage is a smaller project than MinIO with a different operational model
  (cluster layout, per-key permissions). Upgrades, layout changes and metadata
  backups need their own runbook.
- The local Compose stack stores assets in Garage by default; Firebase Storage
  remains available only as the legacy adapter and rollback path.

## Alternatives considered

- **Buy MinIO AIStor.** Keeps the original decision but adds vendor, spend,
  residency and licence review before any use.
- **SeaweedFS.** Apache-2.0 and S3-compatible with bucket creation support, but a
  broader component surface (master, volume, filer, S3 gateway) for this workload.
- **Ceph RGW.** Mature but too heavy for a single small VPS.
- **Keep the adapter and defer runtime verification.** Leaves the migration
  without a working asset store and blocks the vertical journey.

## Verification

- Unit tests cover bucket bootstrap (create on 404, no create on other errors),
  private writes, missing-object mapping, prefix isolation, exact-path deletion,
  batching above 1,000 objects and path validation.
- A real Garage endpoint accepted `S3Assets.init()`, `put` and `get` of a PDF, and
  `deletePrefix` removed the object (subsequent `get` returned `asset_not_found`).
- The Compose vertical journey must store uploaded PDFs in Garage, serve them to the
  worker for OCR, and leave no objects after child and account deletion.
- VPS backup/restore and encrypted-volume verification remain open.

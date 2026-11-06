// Self-hosted runtime configuration (ADR 0013): Postgres documents, Keycloak identity,
// Garage S3 assets and a local polling worker. The loopback defaults mirror the
// synthetic local-only credentials in compose.yaml so `npm run dev` works against
// `npm run docker:up` with no env file. A VPS deployment must inject real secrets.
export type RuntimeMode = 'local';
export type AuthConfig = {
  kind: 'keycloak';
  issuer: string;
  backchannelUrl: string;
  audience: string;
  clientId: string;
  clientSecret: string;
};
export type AssetConfig = {
  kind: 's3';
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};
export type RuntimeConfig = {
  mode: RuntimeMode;
  role: 'api' | 'worker' | 'all';
  host: string;
  port: number;
  requireScan: boolean;
  ocrProvider: 'local' | 'cloudflare';
  ocrMaxRequests: number;
  auth: AuthConfig;
  assets: AssetConfig;
  repository: 'postgres';
  postgres: { url: string };
  limits: { pinPerHour: number; uploadsPerHour: number };
};
function pattern(value: string, expression: RegExp, code: string): string {
  if (!expression.test(value)) throw new Error(code);
  return value;
}
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const LOCAL_SERVICE_HOSTS = ['127.0.0.1', 'localhost', 'keycloak', 'garage'];
function localServiceUrl(value: string | undefined, code: string, pathname?: RegExp): string {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(code);
  }
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !LOCAL_SERVICE_HOSTS.includes(url.hostname) ||
    (pathname && !pathname.test(url.pathname))
  )
    throw new Error(code);
  return url.href.replace(/\/$/, '');
}
function keycloakAuth(env: Record<string, string | undefined>): AuthConfig {
  if (env.AUTH_PROVIDER !== undefined && env.AUTH_PROVIDER !== 'keycloak')
    throw new Error('invalid_auth_provider');
  return {
    kind: 'keycloak',
    issuer: localServiceUrl(
      env.KEYCLOAK_ISSUER ?? 'http://127.0.0.1:8081/realms/lessonbooks',
      'invalid_keycloak_issuer',
      /^\/realms\/[A-Za-z0-9-]{1,63}$/,
    ),
    backchannelUrl: localServiceUrl(
      env.KEYCLOAK_BACKCHANNEL_URL ?? 'http://127.0.0.1:8081',
      'invalid_keycloak_backchannel',
    ),
    audience: pattern(
      env.KEYCLOAK_AUDIENCE ?? 'lessonbooks-api',
      /^[A-Za-z0-9._-]{3,64}$/,
      'invalid_keycloak_audience',
    ),
    clientId: pattern(
      env.KEYCLOAK_CLIENT_ID ?? 'lessonbooks-api',
      /^[A-Za-z0-9._-]{3,64}$/,
      'invalid_keycloak_client_id',
    ),
    clientSecret: pattern(
      env.KEYCLOAK_CLIENT_SECRET ?? 'local-only-api-service-secret-0123456789',
      /^[A-Za-z0-9._~+/=-]{16,256}$/,
      'invalid_keycloak_client_secret',
    ),
  };
}
function s3Assets(env: Record<string, string | undefined>): AssetConfig {
  let endpoint: URL;
  try {
    endpoint = new URL(env.S3_ENDPOINT ?? 'http://127.0.0.1:3900');
  } catch {
    throw new Error('invalid_s3_endpoint');
  }
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    endpoint.port !== '3900' ||
    !['127.0.0.1', 'localhost', 'garage'].includes(endpoint.hostname)
  )
    throw new Error('invalid_s3_endpoint');
  return {
    kind: 's3',
    endpoint: endpoint.origin,
    bucket: pattern(env.S3_BUCKET ?? 'lessonbooks', BUCKET_NAME, 'invalid_s3_bucket'),
    region: pattern(env.S3_REGION ?? 'garage', /^[a-z0-9-]{1,32}$/, 'invalid_s3_region'),
    accessKeyId: pattern(
      env.S3_ACCESS_KEY_ID ?? 'GK0123456789abcdef0123456789abcdef',
      /^[A-Za-z0-9]{16,128}$/,
      'invalid_s3_access_key',
    ),
    secretAccessKey: pattern(
      env.S3_SECRET_ACCESS_KEY ??
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      /^[A-Za-z0-9+/=_-]{8,256}$/,
      'invalid_s3_secret_key',
    ),
  };
}
export function runtimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const ocrProvider = env.OCR_PROVIDER ?? 'local';
  if (ocrProvider !== 'local' && ocrProvider !== 'cloudflare')
    throw new Error('invalid_ocr_provider');
  if (env.LIVE_AI_APPROVED === 'true')
    throw new Error('Use reviewed cloud configuration before production/live AI.');
  const roles = ['api', 'worker', 'all'] as const;
  const selected = roles.find((candidate) => candidate === env.SERVICE_ROLE);
  if (env.SERVICE_ROLE !== undefined && !selected) throw new Error('invalid_service_role');
  const role: (typeof roles)[number] = selected ?? 'all';
  const assetStore = env.ASSET_STORE ?? 's3';
  if (assetStore !== 's3') throw new Error('invalid_asset_store');
  const assets = s3Assets(env);
  const auth = keycloakAuth(env);
  // Self-hosted document store (ADR 0013 phase 4): Postgres requires an explicit
  // connection URL whose host is a loopback or known Compose service.
  const repository = env.REPOSITORY ?? 'postgres';
  if (repository !== 'postgres') throw new Error('invalid_repository');
  let url: URL;
  try {
    url = new URL(
      env.POSTGRES_URL ??
        'postgres://lessonbooks:local-only-documents-db-password@127.0.0.1:5432/lessonbooks',
    );
  } catch {
    throw new Error('invalid_postgres_url');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.username === '' ||
    url.password === '' ||
    url.search ||
    url.hash ||
    !['127.0.0.1', 'localhost', 'postgres'].includes(url.hostname)
  )
    throw new Error('invalid_postgres_url');
  const postgres = { url: url.href };
  let ocrMaxRequests = 0;
  if (ocrProvider === 'cloudflare') {
    // The selectable hosted path is restricted to owned fixtures in the local runtime.
    if (env.NODE_ENV === 'production')
      throw new Error('hosted_ocr_not_approved_for_family_uploads');
    if (role !== 'api' && env.CLOUDFLARE_OCR_APPROVED !== 'true')
      throw new Error('cloudflare_ocr_approval_required');
    ocrMaxRequests = Number(env.CLOUDFLARE_OCR_MAX_REQUESTS ?? '1');
    if (!Number.isInteger(ocrMaxRequests) || ocrMaxRequests < 1 || ocrMaxRequests > 4)
      throw new Error('invalid_ocr_request_limit');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('invalid_bind_host');
  // Rate limits keep the documented 5/hour defaults; the local Compose stack
  // raises them for browser-test repeatability. Overrides must stay bounded.
  const rateLimit = (value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000)
      throw new Error('invalid_rate_limit');
    return parsed;
  };
  const limits = {
    pinPerHour: rateLimit(env.RATE_LIMIT_PIN_PER_HOUR, 5),
    uploadsPerHour: rateLimit(env.RATE_LIMIT_UPLOADS_PER_HOUR, 5),
  };
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
  if (env.REQUIRE_SCAN && !['true', 'false'].includes(env.REQUIRE_SCAN))
    throw new Error('invalid_scan_setting');
  if (env.NODE_ENV === 'production')
    throw new Error('Use reviewed cloud configuration before production/live AI.');
  return {
    mode: 'local',
    role,
    host,
    port,
    requireScan: env.REQUIRE_SCAN === 'true',
    ocrProvider,
    ocrMaxRequests,
    auth,
    assets,
    repository: 'postgres',
    postgres,
    limits,
  };
}

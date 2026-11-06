import { expect, it } from 'vitest';
import { runtimeConfig } from '../src/runtime-config';
const s3Env = {
  ASSET_STORE: 's3',
  S3_ENDPOINT: 'http://garage:3900',
  S3_BUCKET: 'lessonbooks',
  S3_REGION: 'garage',
  S3_ACCESS_KEY_ID: 'GK0123456789abcdef0123456789abcdef',
  S3_SECRET_ACCESS_KEY: 'a'.repeat(64),
};
const keycloakEnv = {
  AUTH_PROVIDER: 'keycloak',
  KEYCLOAK_ISSUER: 'http://127.0.0.1:8081/realms/lessonbooks',
  KEYCLOAK_BACKCHANNEL_URL: 'http://keycloak:8080',
  KEYCLOAK_AUDIENCE: 'lessonbooks-api',
  KEYCLOAK_CLIENT_ID: 'lessonbooks-api',
  KEYCLOAK_CLIENT_SECRET: 'local-only-api-service-secret-0123456789',
};
it('defaults to the self-hosted local runtime with loopback services', () => {
  expect(runtimeConfig({})).toMatchObject({
    mode: 'local',
    role: 'all',
    host: '127.0.0.1',
    port: 3001,
    requireScan: false,
    repository: 'postgres',
    assets: { kind: 's3', endpoint: 'http://127.0.0.1:3900', bucket: 'lessonbooks' },
    auth: {
      kind: 'keycloak',
      issuer: 'http://127.0.0.1:8081/realms/lessonbooks',
      backchannelUrl: 'http://127.0.0.1:8081',
    },
    postgres: {
      url: 'postgres://lessonbooks:local-only-documents-db-password@127.0.0.1:5432/lessonbooks',
    },
  });
});
it('accepts a loopback Garage endpoint for private assets', () => {
  expect(runtimeConfig(s3Env)).toMatchObject({
    mode: 'local',
    assets: {
      kind: 's3',
      endpoint: 'http://garage:3900',
      bucket: 'lessonbooks',
      region: 'garage',
    },
  });
  expect(runtimeConfig({ ...s3Env, S3_ENDPOINT: 'http://127.0.0.1:3900' }).assets).toMatchObject({
    endpoint: 'http://127.0.0.1:3900',
  });
});
it('accepts Keycloak with a public issuer and an internal backchannel', () => {
  expect(runtimeConfig(keycloakEnv)).toMatchObject({
    mode: 'local',
    auth: {
      kind: 'keycloak',
      issuer: 'http://127.0.0.1:8081/realms/lessonbooks',
      backchannelUrl: 'http://keycloak:8080',
      audience: 'lessonbooks-api',
      clientId: 'lessonbooks-api',
    },
  });
});
it.each([
  { AUTH_PROVIDER: 'auth0' },
  { AUTH_PROVIDER: 'firebase' },
  { ...keycloakEnv, KEYCLOAK_ISSUER: '' },
  { ...keycloakEnv, KEYCLOAK_ISSUER: 'http://127.0.0.1:8081/realms/' },
  { ...keycloakEnv, KEYCLOAK_ISSUER: 'http://127.0.0.1:8081/' },
  { ...keycloakEnv, KEYCLOAK_ISSUER: 'https://127.0.0.1:8081/realms/lessonbooks' },
  { ...keycloakEnv, KEYCLOAK_ISSUER: 'http://example.com/realms/lessonbooks' },
  { ...keycloakEnv, KEYCLOAK_BACKCHANNEL_URL: 'http://example.com:8080' },
  { ...keycloakEnv, KEYCLOAK_BACKCHANNEL_URL: '' },
  { ...keycloakEnv, KEYCLOAK_CLIENT_SECRET: 'short' },
  { ...keycloakEnv, KEYCLOAK_CLIENT_SECRET: '' },
  { ...keycloakEnv, KEYCLOAK_AUDIENCE: 'bad audience' },
])('rejects unsafe Keycloak settings %j', (env) => {
  expect(() => runtimeConfig(env)).toThrow();
});
it.each([
  { ASSET_STORE: 'minio' },
  { ASSET_STORE: 'firebase' },
  { ...s3Env, S3_ENDPOINT: '' },
  { ...s3Env, S3_ENDPOINT: 'garage:3900' },
  { ...s3Env, S3_ENDPOINT: 'http://garage:9000' },
  { ...s3Env, S3_ENDPOINT: 'http://example.com:3900' },
  { ...s3Env, S3_ENDPOINT: 'https://garage:3900' },
  { ...s3Env, S3_ENDPOINT: 'http://user:pass@garage:3900' },
  { ...s3Env, S3_ENDPOINT: 'http://garage:3900/bucket' },
  { ...s3Env, S3_BUCKET: 'Bad_Bucket' },
  { ...s3Env, S3_REGION: 'EU West' },
  { ...s3Env, S3_ACCESS_KEY_ID: 'short' },
  { ...s3Env, S3_ACCESS_KEY_ID: '' },
  { ...s3Env, S3_SECRET_ACCESS_KEY: 'short' },
])('rejects unsafe S3 asset settings %j', (env) => {
  expect(() => runtimeConfig(env)).toThrow();
});
it('supports separate container roles and required scanning', () => {
  expect(
    runtimeConfig({
      SERVICE_ROLE: 'worker',
      HOST: '0.0.0.0',
      REQUIRE_SCAN: 'true',
    }),
  ).toMatchObject({ mode: 'local', role: 'worker', requireScan: true });
});
it('rejects live AI before any mode decision', () => {
  expect(() => runtimeConfig({ LIVE_AI_APPROVED: 'true' })).toThrow(
    'Use reviewed cloud configuration before production/live AI.',
  );
});
it.each(['unknown', '', 'Cloudflare'])('rejects invalid OCR provider %j', (OCR_PROVIDER) => {
  expect(() => runtimeConfig({ OCR_PROVIDER })).toThrow('invalid_ocr_provider');
});
it('requires explicit hosted evaluation approval and blocks production regardless of that flag', () => {
  expect(() => runtimeConfig({ OCR_PROVIDER: 'cloudflare' })).toThrow(
    'cloudflare_ocr_approval_required',
  );
  expect(() =>
    runtimeConfig({
      NODE_ENV: 'production',
      OCR_PROVIDER: 'cloudflare',
      CLOUDFLARE_OCR_APPROVED: 'true',
    }),
  ).toThrow('hosted_ocr_not_approved_for_family_uploads');
  expect(
    runtimeConfig({ OCR_PROVIDER: 'cloudflare', CLOUDFLARE_OCR_APPROVED: 'true' }),
  ).toMatchObject({ ocrProvider: 'cloudflare', ocrMaxRequests: 1, mode: 'local' });
});
it.each(['0', '5', '-1', '1.5', '', 'NaN'])(
  'rejects invalid hosted request cap %j',
  (CLOUDFLARE_OCR_MAX_REQUESTS) => {
    expect(() =>
      runtimeConfig({
        OCR_PROVIDER: 'cloudflare',
        CLOUDFLARE_OCR_APPROVED: 'true',
        CLOUDFLARE_OCR_MAX_REQUESTS,
      }),
    ).toThrow('invalid_ocr_request_limit');
  },
);
it('keeps local OCR available even when Cloudflare credentials are injected for separate evaluation', () => {
  expect(
    runtimeConfig({
      OCR_PROVIDER: 'local',
      CLOUDFLARE_API_KEY: 'synthetic-token',
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    }).mode,
  ).toBe('local');
});
it.each([
  { NODE_ENV: 'production' },
  { SERVICE_ROLE: 'unknown' },
  { REQUIRE_SCAN: 'maybe' },
  { PORT: '0' },
  { PORT: '3001.5' },
  { HOST: 'example.com' },
])('rejects unsafe or invalid runtime settings %j', (env) => {
  expect(() => runtimeConfig(env)).toThrow();
});
it('keeps the documented 5/hour rate limits by default and bounds overrides', () => {
  expect(runtimeConfig(keycloakEnv).limits).toEqual({ pinPerHour: 5, uploadsPerHour: 5 });
  expect(
    runtimeConfig({
      ...keycloakEnv,
      RATE_LIMIT_PIN_PER_HOUR: '50',
      RATE_LIMIT_UPLOADS_PER_HOUR: '50',
    }).limits,
  ).toEqual({ pinPerHour: 50, uploadsPerHour: 50 });
  for (const bad of ['0', '-1', '1001', 'abc', '2.5'])
    expect(() => runtimeConfig({ ...keycloakEnv, RATE_LIMIT_PIN_PER_HOUR: bad })).toThrow(
      'invalid_rate_limit',
    );
});
it('defaults to Postgres and accepts a loopback or Compose URL', () => {
  expect(runtimeConfig(keycloakEnv).repository).toBe('postgres');
  expect(
    runtimeConfig({
      ...keycloakEnv,
      POSTGRES_URL:
        'postgres://lessonbooks:local-only-documents-db-password@postgres:5432/lessonbooks',
    }).postgres,
  ).toEqual({
    url: 'postgres://lessonbooks:local-only-documents-db-password@postgres:5432/lessonbooks',
  });
  expect(
    runtimeConfig({
      ...keycloakEnv,
      POSTGRES_URL: 'postgres://lessonbooks:pw@127.0.0.1:5432/lessonbooks',
    }).repository,
  ).toBe('postgres');
});
it.each([
  ['postgres://lessonbooks:pw@db.internal:5432/lessonbooks', 'invalid_postgres_url'],
  ['postgres://lessonbooks@postgres:5432/lessonbooks', 'invalid_postgres_url'],
  ['postgres://lessonbooks:pw@postgres:5432/lessonbooks?sslmode=disable', 'invalid_postgres_url'],
  ['postgresql://lessonbooks:pw@postgres:5432/lessonbooks', undefined],
])('validates the Postgres URL %s', (url, expected) => {
  if (expected === undefined) {
    expect(() => runtimeConfig({ ...keycloakEnv, POSTGRES_URL: url })).not.toThrow();
    return;
  }
  expect(() => runtimeConfig({ ...keycloakEnv, POSTGRES_URL: url })).toThrow(expected);
});
it('rejects unknown repository names', () => {
  expect(() => runtimeConfig({ ...keycloakEnv, REPOSITORY: 'mongo' })).toThrow(
    'invalid_repository',
  );
});

import { expect, it } from 'vitest';
import { runtimeConfig } from '../src/runtime-config';
const cloudEnv = {
  CLOUD_RUNTIME_APPROVED: 'true',
  NODE_ENV: 'production',
  FIREBASE_PROJECT_ID: 'lessonbooks-prod',
  GCLOUD_REGION: 'europe-west6',
  CLOUD_TASKS_LOCATION: 'europe-west6',
  CLOUD_TASKS_QUEUE: 'lesson-generation',
  WORKER_URL: 'https://worker.example.run.app',
  WORKER_SERVICE_ACCOUNT: 'worker@lessonbooks-prod.iam.gserviceaccount.com',
  SERVICE_ROLE: 'worker',
  HOST: '0.0.0.0',
};
it('keeps host defaults emulator-only with combined local processes', () => {
  expect(runtimeConfig({})).toMatchObject({
    mode: 'emulator',
    role: 'all',
    host: '127.0.0.1',
    port: 3001,
    requireScan: false,
  });
});
it('supports separate container roles, known emulator DNS and required scanning', () => {
  expect(
    runtimeConfig({
      SERVICE_ROLE: 'worker',
      HOST: '0.0.0.0',
      REQUIRE_SCAN: 'true',
      FIREBASE_AUTH_EMULATOR_HOST: 'emulators:9099',
      FIRESTORE_EMULATOR_HOST: 'emulators:8080',
      FIREBASE_STORAGE_EMULATOR_HOST: 'emulators:9199',
    }),
  ).toMatchObject({ mode: 'emulator', role: 'worker', requireScan: true });
});
it('accepts a reviewed cloud configuration with explicit residency and queue path', () => {
  expect(runtimeConfig(cloudEnv)).toMatchObject({
    mode: 'cloud',
    role: 'worker',
    projectId: 'lessonbooks-prod',
    queuePath: 'projects/lessonbooks-prod/locations/europe-west6/queues/lesson-generation',
    workerUrl: 'https://worker.example.run.app',
    workerServiceAccount: 'worker@lessonbooks-prod.iam.gserviceaccount.com',
    requireScan: true,
  });
});
it.each([
  { ...cloudEnv, NODE_ENV: 'development' },
  { ...cloudEnv, FIREBASE_PROJECT_ID: 'AB' },
  { ...cloudEnv, GCLOUD_REGION: 'europe-west-6' },
  { ...cloudEnv, CLOUD_TASKS_LOCATION: 'us-central1' },
  { ...cloudEnv, CLOUD_TASKS_QUEUE: '' },
  { ...cloudEnv, WORKER_URL: 'http://worker.example.run.app' },
  { ...cloudEnv, WORKER_URL: 'https://127.0.0.1' },
  { ...cloudEnv, WORKER_SERVICE_ACCOUNT: 'worker@gmail.com' },
  { ...cloudEnv, FIRESTORE_EMULATOR_HOST: 'emulators:8080' },
  { ...cloudEnv, LIVE_AI_APPROVED: 'true' },
])('rejects unsafe cloud settings %j', (env) => {
  expect(() => runtimeConfig(env)).toThrow();
});
it('rejects live AI before any mode decision', () => {
  expect(() => runtimeConfig({ LIVE_AI_APPROVED: 'true' })).toThrow(
    'Use reviewed cloud configuration before production/live AI.',
  );
});
it.each(['cloudflare', 'unknown', ''])(
  'rejects hosted OCR selection %j for family workers in every mode',
  (OCR_PROVIDER) => {
    for (const env of [{ OCR_PROVIDER }, { ...cloudEnv, OCR_PROVIDER }])
      expect(() => runtimeConfig(env)).toThrow('hosted_ocr_not_approved_for_family_uploads');
  },
);
it('keeps local OCR available even when Cloudflare credentials are injected for separate evaluation', () => {
  expect(
    runtimeConfig({
      OCR_PROVIDER: 'local',
      CLOUDFLARE_API_KEY: 'synthetic-token',
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    }).mode,
  ).toBe('emulator');
});
it.each([
  { NODE_ENV: 'production' },
  { SERVICE_ROLE: 'unknown' },
  { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
  { FIREBASE_AUTH_EMULATOR_HOST: 'emulators:443' },
  { REQUIRE_SCAN: 'maybe' },
  { PORT: '0' },
  { PORT: '3001.5' },
  { HOST: 'example.com' },
])('rejects unsafe or invalid runtime settings %j', (env) => {
  expect(() => runtimeConfig(env)).toThrow();
});

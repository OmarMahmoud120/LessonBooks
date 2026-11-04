import { expect, it } from 'vitest';
import { runtimeConfig } from '../src/runtime-config';
it('keeps host defaults emulator-only with combined local processes', () => {
  expect(runtimeConfig({})).toMatchObject({
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
  ).toMatchObject({ role: 'worker', requireScan: true });
});
it.each([
  { NODE_ENV: 'production' },
  { LIVE_AI_APPROVED: 'true' },
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

import { expect, it } from 'vitest';
import { testEmulatorEndpoints } from './emulator-config';
it('uses loopback defaults and accepts explicitly isolated emulator ports', () => {
  expect(testEmulatorEndpoints({}).FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
  expect(
    testEmulatorEndpoints({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080' }).FIRESTORE_EMULATOR_HOST,
  ).toBe('127.0.0.1:18080');
});
it.each(['production.example:8080', '127.0.0.1:999', '127.0.0.1:65536', 'http://127.0.0.1:8080'])(
  'rejects nonlocal or invalid emulator target %s',
  (FIRESTORE_EMULATOR_HOST) => {
    expect(() => testEmulatorEndpoints({ FIRESTORE_EMULATOR_HOST })).toThrow(
      'tests_require_loopback_emulators',
    );
  },
);

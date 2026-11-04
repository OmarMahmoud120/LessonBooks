// Keep verification on loopback while allowing an isolated emulator stack beside local development.
export function testEmulatorEndpoints(env: Record<string, string | undefined> = process.env) {
  const endpoints = {
    FIREBASE_AUTH_EMULATOR_HOST: env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080',
    FIREBASE_STORAGE_EMULATOR_HOST: env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199',
  };
  for (const value of Object.values(endpoints)) {
    const match = /^(?:127\.0\.0\.1|localhost):([0-9]{4,5})$/.exec(value);
    if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535)
      throw new Error('tests_require_loopback_emulators');
  }
  return endpoints;
}

export function runtimeConfig(env: Record<string, string | undefined>) {
  if (env.NODE_ENV === 'production' || env.LIVE_AI_APPROVED === 'true')
    throw new Error('Use reviewed cloud configuration before production/live AI.');
  const role = env.SERVICE_ROLE ?? 'all';
  if (!['api', 'worker', 'all'].includes(role)) throw new Error('invalid_service_role');
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('invalid_bind_host');
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
  if (env.REQUIRE_SCAN && !['true', 'false'].includes(env.REQUIRE_SCAN))
    throw new Error('invalid_scan_setting');
  const endpoints: Record<string, string> = {};
  for (const [key, expectedPort] of [
    ['FIREBASE_AUTH_EMULATOR_HOST', 9099],
    ['FIRESTORE_EMULATOR_HOST', 8080],
    ['FIREBASE_STORAGE_EMULATOR_HOST', 9199],
  ] as const) {
    const value = env[key] ?? `127.0.0.1:${expectedPort}`;
    if (
      !['127.0.0.1', 'localhost', 'emulators'].some((name) => value === `${name}:${expectedPort}`)
    )
      throw new Error('invalid_emulator_endpoint');
    endpoints[key] = value;
  }
  return { role, host, port, requireScan: env.REQUIRE_SCAN === 'true', endpoints };
}

export type RuntimeMode = 'emulator' | 'cloud';
export type RuntimeConfig = {
  mode: RuntimeMode;
  role: 'api' | 'worker' | 'all';
  host: string;
  port: number;
  requireScan: boolean;
  endpoints: Record<string, string>;
  projectId?: string;
  queuePath?: string;
  workerUrl?: string;
  workerServiceAccount?: string;
};
function pattern(value: string, expression: RegExp, code: string): string {
  if (!expression.test(value)) throw new Error(code);
  return value;
}
export function runtimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  if (env.LIVE_AI_APPROVED === 'true')
    throw new Error('Use reviewed cloud configuration before production/live AI.');
  const roles = ['api', 'worker', 'all'] as const;
  const selected = roles.find((candidate) => candidate === env.SERVICE_ROLE);
  if (env.SERVICE_ROLE !== undefined && !selected) throw new Error('invalid_service_role');
  const role: (typeof roles)[number] = selected ?? 'all';
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('invalid_bind_host');
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
  if (env.REQUIRE_SCAN && !['true', 'false'].includes(env.REQUIRE_SCAN))
    throw new Error('invalid_scan_setting');
  const emulatorEndpointNames = [
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ] as const;
  if (env.CLOUD_RUNTIME_APPROVED === 'true') {
    if (env.NODE_ENV !== 'production') throw new Error('cloud_requires_production_hardening');
    if (role === 'all') throw new Error('cloud_requires_separate_roles');
    if (emulatorEndpointNames.some((key) => env[key]))
      throw new Error('emulator_endpoints_forbidden');
    const projectId = pattern(
      env.FIREBASE_PROJECT_ID ?? '',
      /^[a-z][a-z0-9-]{4,28}$/,
      'invalid_project_id',
    );
    const region = pattern(
      env.GCLOUD_REGION ?? '',
      /^[a-z]{2,12}-[a-z]+[0-9]{1,2}$/,
      'invalid_region',
    );
    const location = pattern(
      env.CLOUD_TASKS_LOCATION ?? '',
      /^[a-z]{2,12}-[a-z]+[0-9]{1,2}$/,
      'invalid_tasks_location',
    );
    if (location !== region) throw new Error('tasks_location_mismatch');
    const queue = pattern(
      env.CLOUD_TASKS_QUEUE ?? '',
      /^[a-zA-Z][a-zA-Z0-9_-]{0,499}$/,
      'invalid_queue',
    );
    const workerUrl = pattern(
      env.WORKER_URL ?? '',
      /^https:\/\/[a-z0-9.-]{4,253}(:[0-9]{2,5})?\/?$/,
      'invalid_worker_url',
    );
    if (['127.0.0.1', 'localhost', '::1'].includes(new URL(workerUrl).hostname))
      throw new Error('invalid_worker_url');
    const workerServiceAccount = pattern(
      env.WORKER_SERVICE_ACCOUNT ?? '',
      /^[a-z][a-z0-9-]{4,30}@[a-z][a-z0-9.-]{4,60}\.iam\.gserviceaccount\.com$/,
      'invalid_worker_service_account',
    );
    return {
      mode: 'cloud',
      role,
      host,
      port,
      requireScan: env.REQUIRE_SCAN !== 'false',
      endpoints: {},
      projectId,
      queuePath: `projects/${projectId}/locations/${location}/queues/${queue}`,
      workerUrl,
      workerServiceAccount,
    };
  }
  if (env.NODE_ENV === 'production')
    throw new Error('Use reviewed cloud configuration before production/live AI.');
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
  return {
    mode: 'emulator',
    role,
    host,
    port,
    requireScan: env.REQUIRE_SCAN === 'true',
    endpoints,
  };
}

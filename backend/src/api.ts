import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { DomainError, familyPath, type Job, type Kid, type LessonRecord } from './domain';
import { FamilyService } from './family';
import { AdminOps, AuditLog } from './admin';
import catalog from '../../doc/curricula/england.json';

// Realm role that marks an operator identity (ADR 0016). Interactive logins only:
// client-credentials tokens carry no `sid`, so service accounts cannot reach the
// admin surface even when their client holds the role.
const ADMIN_ROLE = 'lessonbooks-admin';
const DEFAULT_AUDIT_LIMIT = 50;

// Identity providers that cannot put a trustworthy authentication time in the
// access token resolve it lazily, so no extra lookup happens on ordinary requests.
// Roles come from the identity provider's realm-role claim; the Firebase provider
// sets none, so admin routes fail closed under it.
export type Identity = {
  uid: string;
  roles?: string[] | undefined;
  auth_time: number | (() => Promise<number>);
};
export async function authTime(identity: Identity): Promise<number> {
  return typeof identity.auth_time === 'function' ? identity.auth_time() : identity.auth_time;
}
// Fails closed: an identity provider that cannot prove a recent login is treated as
// unauthenticated rather than as a stale session.
async function requireRecentAuth(identity: Identity) {
  let authenticatedAt: number;
  try {
    authenticatedAt = await authTime(identity);
  } catch {
    throw new DomainError('unauthenticated', 401);
  }
  if (Date.now() / 1000 - authenticatedAt > 300) throw new DomainError('recent_auth_required', 401);
}
export async function createAPI(
  families: FamilyService,
  verify: (token: string) => Promise<Identity>,
  audit?: AuditLog,
  ops?: AdminOps,
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(cors, {
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });
  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const identities = new WeakMap<object, Identity>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (
      request.method === 'OPTIONS' ||
      ['/health', '/v1/catalog'].includes(request.url.split('?')[0] ?? '')
    )
      return;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ') || header.length > 8192)
      throw new DomainError('unauthenticated', 401);
    try {
      identities.set(request, await verify(header.slice(7)));
    } catch {
      throw new DomainError('unauthenticated', 401);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const typed = error as Error & { validation?: unknown; statusCode?: number };
    const status =
      error instanceof DomainError
        ? error.status
        : typed.validation
          ? 400
          : typed.statusCode && typed.statusCode < 500
            ? typed.statusCode
            : 500;
    reply.code(status).send({
      error:
        error instanceof DomainError
          ? error.code
          : status === 400
            ? 'invalid_request'
            : status === 413
              ? 'upload_too_large'
              : 'request_failed',
    });
  });
  const uid = (request: object) => {
    const identity = identities.get(request);
    if (!identity) throw new DomainError('unauthenticated', 401);
    return identity.uid;
  };
  const idSchema = {
    type: 'object',
    properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' } },
    required: ['id'],
    additionalProperties: false,
  };
  app.get('/health', async () => ({ status: 'ok', mode: 'parent-preview' }));
  app.get('/v1/catalog', async () => catalog);
  app.get('/v1/family', async (request) => {
    const overview = await families.overview(uid(request));
    return { ...overview, pin_set: Boolean((overview.parent as { pin_hash?: string }).pin_hash) };
  });
  app.post<{ Body: { type: 'privacy' | 'content_rights'; version: '2026-11-03'; granted: true } }>(
    '/v1/consents',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            type: { enum: ['privacy', 'content_rights'] },
            version: { const: '2026-11-03' },
            granted: { const: true },
          },
          required: ['type', 'version', 'granted'],
          additionalProperties: false,
        },
      },
    },
    async (request) => families.consent(uid(request), request.body.type),
  );
  const kidProperties = {
    nickname: { type: 'string', minLength: 1, maxLength: 30, pattern: '^[^<>\\r\\n]+$' },
    avatar: { enum: ['fox', 'owl', 'cat'] },
    age_band: { enum: ['5-7', '6-8'] },
    country: { const: 'GB-ENG' },
    language: { enum: ['en-GB', 'ar'] },
    curriculum_id: { const: 'england-national-2014' },
    grade_id: { enum: ['year-1', 'year-2'] },
    reading_level: { enum: ['emerging', 'developing'] },
  };
  app.post<{ Body: Omit<Kid, 'id' | 'state'> }>(
    '/v1/kids',
    {
      schema: {
        body: {
          type: 'object',
          properties: kidProperties,
          required: Object.keys(kidProperties),
          additionalProperties: false,
        },
      },
    },
    async (request) => families.addKid(uid(request), request.body),
  );
  app.delete<{ Params: { id: string } }>(
    '/v1/kids/:id',
    { schema: { params: idSchema } },
    async (request) => {
      await families.deleteKid(uid(request), request.params.id);
      return { deleted: true };
    },
  );
  app.delete('/v1/account', async (request) => {
    const identity = identities.get(request)!;
    await requireRecentAuth(identity);
    await families.deleteAccount(uid(request));
    return { deleted: true };
  });
  const pinSchema = {
    type: 'object',
    properties: { pin: { type: 'string', pattern: '^[0-9]{4,8}$' } },
    required: ['pin'],
    additionalProperties: false,
  };
  app.post<{ Body: { pin: string } }>(
    '/v1/parent/pin',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: { body: pinSchema },
    },
    async (request) => {
      const identity = identities.get(request)!;
      await requireRecentAuth(identity);
      await families.setPin(uid(request), request.body.pin);
      return { pin_set: true };
    },
  );
  app.post<{ Body: { pin: string } }>(
    '/v1/parent/pin/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: pinSchema } },
    async (request) => {
      await families.verifyPin(uid(request), request.body.pin);
      return { ok: true };
    },
  );
  app.post<{ Querystring: { kid_id: string } }>(
    '/v1/books',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        querystring: {
          type: 'object',
          properties: { kid_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' } },
          required: ['kid_id'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string') throw new DomainError('idempotency_key_required');
      const file = await request.file();
      if (!file || file.mimetype !== 'application/pdf') throw new DomainError('pdf_required');
      const bytes = await file.toBuffer();
      if (file.file.truncated) throw new DomainError('upload_too_large', 413);
      const result = await families.upload(uid(request), request.query.kid_id, bytes, key);
      reply.code(202);
      return result;
    },
  );
  app.get<{ Params: { id: string } }>(
    '/v1/jobs/:id',
    { schema: { params: idSchema } },
    async (request) => {
      const job = await families.repo.get<Job>(
        familyPath(uid(request), 'generation_jobs', request.params.id),
      );
      if (!job) throw new DomainError('job_not_found', 404);
      await families.repo.atomic((tx) => families.active(tx, uid(request), job.kid_id));
      return {
        id: job.id,
        stage: job.stage,
        status: job.status,
        progress: job.progress,
        error: job.error_code ?? null,
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/retry',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } }, schema: { params: idSchema } },
    async (request) => families.retryJob(uid(request), request.params.id),
  );
  app.get('/v1/lessons', async (request) => {
    await families.repo.atomic((tx) => families.active(tx, uid(request)));
    return (await families.repo.list<LessonRecord>(familyPath(uid(request), 'lessons'))).map(
      ({ storage_path: _path, ...record }) => record,
    );
  });
  app.post<{ Body: { kid_id: string; lesson_id: string } }>(
    '/v1/assignments',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            kid_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
            lesson_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
          },
          required: ['kid_id', 'lesson_id'],
          additionalProperties: false,
        },
      },
    },
    async (request) => families.assign(uid(request), request.body.kid_id, request.body.lesson_id),
  );
  app.get('/v1/assignments', async (request) => families.listAssignments(uid(request)));
  app.get<{ Params: { id: string } }>(
    '/v1/kids/:id/progress',
    { schema: { params: idSchema } },
    async (request) => families.progress(uid(request), request.params.id),
  );
  app.post<{ Body: { events: unknown[] } }>(
    '/v1/events',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          properties: {
            events: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object' } },
          },
          required: ['events'],
          additionalProperties: false,
        },
      },
    },
    async (request) => families.recordEvents(uid(request), request.body.events),
  );
  app.delete<{ Params: { id: string } }>(
    '/v1/assignments/:id',
    { schema: { params: idSchema } },
    async (request) => families.unassign(uid(request), request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/lessons/:id',
    { schema: { params: idSchema } },
    async (request) => {
      const { record, lesson } = await families.lesson(uid(request), request.params.id);
      return { lesson, revision: record.revision, status: record.status };
    },
  );
  app.post<{ Params: { id: string }; Body: { revision: number } }>(
    '/v1/lessons/:id/approve',
    {
      schema: {
        params: idSchema,
        body: {
          type: 'object',
          properties: { revision: { type: 'integer', minimum: 1 } },
          required: ['revision'],
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { storage_path: _path, ...record } = await families.approve(
        uid(request),
        request.params.id,
        request.body.revision,
      );
      return record;
    },
  );
  // Admin surface (ADR 0016): a separate role-gated operator account class. Every
  // admin action is recorded in the append-only audit log before it is answered,
  // and every check fails closed. Routes are not registered until the services
  // they need are provided.
  if (audit || ops) {
    const adminIdentity = (request: object): Identity => {
      const identity = identities.get(request)!;
      if (!identity.roles?.includes(ADMIN_ROLE)) throw new DomainError('forbidden', 403);
      return identity;
    };
    if (audit) {
      app.get<{ Querystring: { limit?: string } }>(
        '/v1/admin/audit',
        {
          schema: {
            querystring: {
              type: 'object',
              properties: { limit: { type: 'string', pattern: '^[0-9]{1,3}$' } },
              additionalProperties: false,
            },
          },
        },
        async (request) => {
          const identity = adminIdentity(request);
          // Reading the audit log is itself sensitive: it exposes operator activity.
          await requireRecentAuth(identity);
          const limit = Number(request.query.limit ?? String(DEFAULT_AUDIT_LIMIT));
          const entries = await audit.list(limit);
          await audit.record(
            'admin.audit.list',
            identity.uid,
            `limit=${limit} returned=${entries.length}`,
          );
          return { entries };
        },
      );
    }
    if (ops) {
      app.get<{ Querystring: { limit?: string; status?: string } }>(
        '/v1/admin/jobs',
        {
          schema: {
            querystring: {
              type: 'object',
              properties: {
                limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
                status: { enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] },
              },
              additionalProperties: false,
            },
          },
        },
        async (request) => {
          const identity = adminIdentity(request);
          await requireRecentAuth(identity);
          const limit = Number(request.query.limit ?? String(DEFAULT_AUDIT_LIMIT));
          const jobs = await ops.listJobs(limit, request.query.status as Job['status']);
          await audit?.record(
            'admin.jobs.list',
            identity.uid,
            `limit=${limit} status=${request.query.status ?? 'any'} returned=${jobs.length}`,
          );
          return { jobs };
        },
      );
      app.post<{ Params: { id: string } }>(
        '/v1/admin/jobs/:id/retry',
        { schema: { params: idSchema } },
        async (request) => {
          const identity = adminIdentity(request);
          await requireRecentAuth(identity);
          const result = await ops.retryJob(request.params.id);
          await audit?.record('admin.job.retry', identity.uid, `job=${request.params.id}`);
          return result;
        },
      );
      app.get('/v1/admin/usage', async (request) => {
        const identity = adminIdentity(request);
        await requireRecentAuth(identity);
        const totals = await ops.usageTotals();
        await audit?.record(
          'admin.usage.list',
          identity.uid,
          `calls=${totals.totals.calls} cost_usd=${totals.totals.cost_usd}`,
        );
        return totals;
      });
    }
  }
  return app;
}

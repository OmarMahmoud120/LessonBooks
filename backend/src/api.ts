import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { DomainError, familyPath, type Job, type Kid, type LessonRecord } from './domain';
import { FamilyService } from './family';
import catalog from '../../doc/curricula/england.json';

export type Identity = { uid: string; auth_time: number };
export async function createAPI(
  families: FamilyService,
  verify: (token: string) => Promise<Identity>,
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
    if (Date.now() / 1000 - identity.auth_time > 300)
      throw new DomainError('recent_auth_required', 401);
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
      if (Date.now() / 1000 - identity.auth_time > 300)
        throw new DomainError('recent_auth_required', 401);
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
  app.get('/v1/lessons', async (request) => {
    await families.repo.atomic((tx) => families.active(tx, uid(request)));
    return (await families.repo.list<LessonRecord>(familyPath(uid(request), 'lessons'))).map(
      ({ storage_path: _path, ...record }) => record,
    );
  });
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
  return app;
}

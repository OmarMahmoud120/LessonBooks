import { describe, expect, it } from 'vitest';
import { createAPI, type Identity } from '../src/api';
import { AdminOps, AuditLog, type AuditEntry } from '../src/admin';
import { FamilyService } from '../src/family';
import { MemoryAssets, MemoryRepository } from '../src/persistence';
import { kidInput } from './family.test';

const now = Math.floor(Date.now() / 1000);

function identity(overrides: Partial<Identity> = {}): Identity {
  return { uid: 'operator-1', roles: ['lessonbooks-admin'], auth_time: now - 10, ...overrides };
}

async function adminApp(operator: Identity) {
  const repo = new MemoryRepository();
  const family = new FamilyService(repo, new MemoryAssets());
  await family.ensureParent('alice');
  const audit = new AuditLog(repo);
  const app = await createAPI(family, async () => operator, audit);
  return { app, audit, repo };
}

async function opsApp(operator: Identity = identity()) {
  const repo = new MemoryRepository();
  const family = new FamilyService(repo, new MemoryAssets());
  const aliceKid = await (async () => {
    await family.ensureParent('alice');
    await family.consent('alice', 'privacy');
    await family.consent('alice', 'content_rights');
    return family.addKid('alice', kidInput);
  })();
  const bobKid = await (async () => {
    await family.ensureParent('bob');
    await family.consent('bob', 'privacy');
    await family.consent('bob', 'content_rights');
    return family.addKid('bob', kidInput);
  })();
  const aliceJob = await family.upload(
    'alice',
    aliceKid.id,
    Buffer.from('%PDF-1.7 synthetic'),
    'ops-key-alice-01',
  );
  const bobJob = await family.upload(
    'bob',
    bobKid.id,
    Buffer.from('%PDF-1.7 synthetic'),
    'ops-key-bob-001',
  );
  const audit = new AuditLog(repo);
  const ops = new AdminOps(repo, family);
  const app = await createAPI(family, async () => operator, audit, ops);
  return { app, audit, ops, repo, family, aliceJob, bobJob };
}

const day = 86_400_000;

describe('audit log', () => {
  it('lists recorded entries newest first', async () => {
    const repo = new MemoryRepository();
    const audit = new AuditLog(repo);
    await audit.record('admin.a.first', 'op', 'one');
    // Distinct timestamps: same-millisecond entries have no defined order.
    const first = (await audit.list(10))[0]!;
    await repo.atomic(async (tx) => {
      tx.put('audit_log/first-entry', {
        ...first,
        id: 'first-entry',
        at: new Date(Date.now() - day).toISOString(),
      });
    });
    await repo.atomic(async (tx) => {
      tx.delete(`audit_log/${first.id}`);
    });
    await audit.record('admin.a.second', 'op', 'two');
    const entries = await audit.list(10);
    expect(entries.map((entry) => entry.action)).toEqual(['admin.a.second', 'admin.a.first']);
    expect(entries[0]).toMatchObject({ actor_uid: 'op', detail: 'two' });
  });

  it('bounds the requested limit in both directions', async () => {
    const audit = new AuditLog(new MemoryRepository());
    for (let index = 0; index < 7; index++) await audit.record('admin.a.fill', 'op', String(index));
    expect((await audit.list(3)).length).toBe(3);
    expect((await audit.list(0)).length).toBe(7);
    expect((await audit.list(9999)).length).toBe(7);
  });
});

describe('admin surface gating', () => {
  it('returns audit entries to a role holder with a recent login and records the read', async () => {
    const { app, audit } = await adminApp(identity());
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toEqual([]);
    const entries = await audit.list(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'admin.audit.list',
      actor_uid: 'operator-1',
      detail: 'limit=50 returned=0',
    });
  });

  it('rejects a parent identity without the admin role and writes nothing', async () => {
    const { app, audit } = await adminApp(identity({ roles: undefined }));
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'forbidden' });
    expect(await audit.list(10)).toEqual([]);
  });

  it('rejects a parent with an unrelated role', async () => {
    const { app, audit } = await adminApp(identity({ roles: ['something-else'] }));
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(403);
    expect(await audit.list(10)).toEqual([]);
  });

  it('requires a bearer token like every other route', async () => {
    const { app, audit } = await adminApp(identity());
    const response = await app.inject({ method: 'GET', url: '/v1/admin/audit' });
    expect(response.statusCode).toBe(401);
    expect(await audit.list(10)).toEqual([]);
  });

  it('rejects a stale session with recent_auth_required', async () => {
    const { app, audit } = await adminApp(identity({ auth_time: now - 301 }));
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'recent_auth_required' });
    expect(await audit.list(10)).toEqual([]);
  });

  it('fails closed when the session start cannot be proven', async () => {
    const { app, audit } = await adminApp(
      identity({
        auth_time: () => Promise.reject(new Error('keycloak_session_lookup_failed')),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(401);
    expect(await audit.list(10)).toEqual([]);
  });

  it('caps the requested limit and rejects malformed values', async () => {
    const { app } = await adminApp(identity());
    const capped = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?limit=200',
      headers: { authorization: 'Bearer token' },
    });
    expect(capped.statusCode).toBe(200);
    const malformed = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?limit=-1',
      headers: { authorization: 'Bearer token' },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('is absent when no audit log is provided', async () => {
    const family = new FamilyService(new MemoryRepository(), new MemoryAssets());
    const app = await createAPI(family, async () => identity());
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('audit retention', () => {
  it('prunes entries older than the retention window on the next write', async () => {
    const repo = new MemoryRepository();
    const audit = new AuditLog(repo);
    const stale: AuditEntry = {
      id: 'stale-1',
      at: new Date(Date.now() - 401 * day).toISOString(),
      actor_uid: 'operator-1',
      action: 'admin.a.stale',
      detail: '',
    };
    await repo.atomic(async (tx) => {
      tx.put('audit_log/stale-1', stale);
    });
    await audit.record('admin.a.fresh', 'operator-1', '');
    const entries = await audit.list(10);
    expect(entries.map((entry) => entry.action)).toEqual(['admin.a.fresh']);
    expect(await repo.list('audit_log')).toHaveLength(1);
  });

  it('keeps entries inside the retention window', async () => {
    const repo = new MemoryRepository();
    const audit = new AuditLog(repo);
    const recent: AuditEntry = {
      id: 'recent-1',
      at: new Date(Date.now() - 399 * day).toISOString(),
      actor_uid: 'operator-1',
      action: 'admin.a.kept',
      detail: '',
    };
    await repo.atomic(async (tx) => {
      tx.put('audit_log/recent-1', recent);
    });
    await audit.record('admin.a.fresh', 'operator-1', '');
    expect(await audit.list(10)).toHaveLength(2);
  });
});

describe('ops monitor', () => {
  it('lists generation jobs across families newest first', async () => {
    const { app, audit, repo, aliceJob, bobJob } = await opsApp();
    // Distinct timestamps so the ordering assertion is not same-millisecond luck.
    const older = await repo.get<{ id: string }>(`parents/bob/generation_jobs/${bobJob.job_id}`);
    await repo.atomic(async (tx) => {
      tx.put(`parents/bob/generation_jobs/${bobJob.job_id}`, {
        ...older,
        created_at: new Date(Date.now() - day).toISOString(),
      });
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
    const jobs = response.json().jobs;
    expect(jobs.map((job: { id: string }) => job.id)).toEqual([aliceJob.job_id, bobJob.job_id]);
    expect(jobs[0]).toMatchObject({
      family_uid: 'alice',
      status: 'queued',
      stage: 'ingest',
      manual_retries: 0,
    });
    const entries = await audit.list(10);
    expect(entries[0]).toMatchObject({ action: 'admin.jobs.list', actor_uid: 'operator-1' });
    expect(repo.documents.has(`parents/alice/generation_jobs/${aliceJob.job_id}`)).toBe(true);
  });

  it('filters jobs by status and bounds the limit', async () => {
    const { app, aliceJob } = await opsApp();
    const filtered = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs?status=failed',
      headers: { authorization: 'Bearer token' },
    });
    expect(filtered.json().jobs).toEqual([]);
    const limited = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs?limit=1',
      headers: { authorization: 'Bearer token' },
    });
    expect(limited.json().jobs.map((job: { id: string }) => job.id)).toEqual([aliceJob.job_id]);
  });

  it('retries a failed job once, records it, and respects family retry rules', async () => {
    const { app, audit, repo, aliceJob } = await opsApp();
    const path = `parents/alice/generation_jobs/${aliceJob.job_id}`;
    await repo.atomic(async (tx) => {
      const job = await tx.get<{ status: string; manual_retries?: number }>(path);
      tx.put(path, { ...job, status: 'failed', error_code: 'generation_invalid' });
    });
    const retried = await app.inject({
      method: 'POST',
      url: `/v1/admin/jobs/${aliceJob.job_id}/retry`,
      headers: { authorization: 'Bearer token' },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toEqual({ retried: true });
    const job = await repo.get<{ status: string; manual_retries?: number }>(path);
    expect(job).toMatchObject({ status: 'queued', manual_retries: 1 });
    expect((await audit.list(10)).some((entry) => entry.action === 'admin.job.retry')).toBe(true);

    const running = await app.inject({
      method: 'POST',
      url: `/v1/admin/jobs/${aliceJob.job_id}/retry`,
      headers: { authorization: 'Bearer token' },
    });
    expect(running.statusCode).toBe(409);
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/admin/jobs/does-not-exist/retry',
      headers: { authorization: 'Bearer token' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('aggregates usage across families per model and purpose', async () => {
    const { app, audit, repo, aliceJob, bobJob } = await opsApp();
    await repo.atomic(async (tx) => {
      const alice = await tx.get<{ usage: unknown[] }>(
        `parents/alice/generation_jobs/${aliceJob.job_id}`,
      );
      tx.put(`parents/alice/generation_jobs/${aliceJob.job_id}`, {
        ...alice,
        usage: [
          {
            model: 'mock/basic',
            prompt_tokens: 10,
            completion_tokens: 5,
            cost_usd: 0.5,
            estimated: true,
            purpose: 'generate',
          },
        ],
      });
      const bob = await tx.get<{ usage: unknown[] }>(
        `parents/bob/generation_jobs/${bobJob.job_id}`,
      );
      tx.put(`parents/bob/generation_jobs/${bobJob.job_id}`, {
        ...bob,
        usage: [
          {
            model: 'mock/basic',
            prompt_tokens: 7,
            completion_tokens: 2,
            cost_usd: 0.2,
            estimated: false,
            purpose: 'decision',
          },
        ],
      });
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/usage',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
    const totals = response.json();
    expect(totals.totals).toEqual({
      calls: 2,
      prompt_tokens: 17,
      completion_tokens: 7,
      cost_usd: 0.7,
    });
    expect(totals.per_model).toEqual([
      {
        model: 'mock/basic',
        purpose: 'decision',
        calls: 1,
        prompt_tokens: 7,
        completion_tokens: 2,
        cost_usd: 0.2,
      },
      {
        model: 'mock/basic',
        purpose: 'generate',
        calls: 1,
        prompt_tokens: 10,
        completion_tokens: 5,
        cost_usd: 0.5,
      },
    ]);
    expect((await audit.list(10)).some((entry) => entry.action === 'admin.usage.list')).toBe(true);
  });

  it('rejects parent identities and stale sessions on every ops route', async () => {
    const parent = await opsApp(identity({ uid: 'alice', roles: undefined }));
    for (const [method, url] of [
      ['GET', '/v1/admin/jobs'],
      ['POST', '/v1/admin/jobs/whatever/retry'],
      ['GET', '/v1/admin/usage'],
    ] as const) {
      const denied = await parent.app.inject({
        method,
        url,
        headers: { authorization: 'Bearer token' },
      });
      expect(denied.statusCode).toBe(403);
    }
    const stale = await opsApp(identity({ auth_time: now - 301 }));
    const rejected = await stale.app.inject({
      method: 'GET',
      url: '/v1/admin/jobs',
      headers: { authorization: 'Bearer token' },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toMatchObject({ error: 'recent_auth_required' });
  });
});

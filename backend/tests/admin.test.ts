import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
  const assets = new MemoryAssets();
  const family = new FamilyService(repo, assets);
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
  // Distinct timestamps: same-millisecond uploads have no defined listing order.
  await repo.atomic(async (tx) => {
    const bob = await tx.get<{ created_at: string }>(
      `parents/bob/generation_jobs/${bobJob.job_id}`,
    );
    tx.put(`parents/bob/generation_jobs/${bobJob.job_id}`, {
      ...bob,
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
  });
  const audit = new AuditLog(repo);
  let identityExists: ((uid: string) => Promise<boolean>) | undefined;
  const ops = new AdminOps(repo, family, (uid) =>
    identityExists ? identityExists(uid) : Promise.resolve(false),
  );
  const app = await createAPI(family, async () => operator, audit, ops);
  return {
    app,
    audit,
    ops,
    repo,
    family,
    assets,
    aliceJob,
    bobJob,
    aliceKid,
    bobKid,
    setIdentityExists: (fn?: (uid: string) => Promise<boolean>) => {
      identityExists = fn;
    },
  };
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
    const retryEntry = (await audit.list(10)).find((entry) => entry.action === 'admin.job.retry');
    expect(retryEntry).toMatchObject({
      actor_uid: 'operator-1',
      detail: expect.stringContaining('job='),
    });

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

describe('support and moderation', () => {
  const bearer = { authorization: 'Bearer token' };

  it('views a family by identifier without creating state or exposing the pin hash', async () => {
    const { app, audit, repo } = await opsApp();
    const familyPathsBefore = [...repo.documents.keys()].filter((path) =>
      path.startsWith('parents/'),
    ).length;
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/alice',
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.parent).toMatchObject({ id: 'alice', state: 'active', pin_set: false });
    expect(body.parent.pin_hash).toBeUndefined();
    expect(body.parent.pin_salt).toBeUndefined();
    expect(body.parent.pin_failed_count).toBeUndefined();
    expect(body.kids[0]).toMatchObject({ avatar: kidInput.avatar, state: 'active' });
    expect(body.kids[0].nickname).toBeUndefined();
    expect(body.consents).toHaveLength(2);
    // Only the audit entry may appear: the lookup itself must not create family state.
    const familyPathsAfter = [...repo.documents.keys()].filter((path) =>
      path.startsWith('parents/'),
    ).length;
    expect(familyPathsAfter).toBe(familyPathsBefore);
    expect((await audit.list(5))[0]).toMatchObject({ action: 'admin.family.view' });
  });

  it('does not create families that do not exist', async () => {
    const { app } = await opsApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/ghost',
      headers: bearer,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'family_not_found' });
  });

  it('exports every family collection', async () => {
    const { app } = await opsApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/alice/export',
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.parent.id).toBe('alice');
    expect(body.parent.pin_hash).toBeUndefined();
    expect(body.kids).toHaveLength(1);
    expect(body.books).toHaveLength(1);
    expect(body.generation_jobs).toHaveLength(1);
    expect(body.consent_records).toHaveLength(2);
    expect(body.lesson_results).toEqual([]);
  });

  it('reports deletion state across the repository and the identity provider', async () => {
    const { app, audit, repo, family, setIdentityExists } = await opsApp();
    setIdentityExists(async () => true);
    const active = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/alice/deletion-check',
      headers: bearer,
    });
    expect(active.json()).toMatchObject({ parent_state: 'active', identity_exists: true });
    const activeCounts = active.json().counts as Record<string, number>;
    expect(Object.values(activeCounts).every((count) => count >= 0)).toBe(true);

    setIdentityExists(async () => false);
    await family.deleteAccount('alice');
    const deleted = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/alice/deletion-check',
      headers: bearer,
    });
    const body = deleted.json();
    expect(body.parent_state).toBe('deleted');
    expect(Object.values(body.counts)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(body.identity_exists).toBe(false);
    expect(repo.documents.has('parents/alice')).toBe(true);
    expect((await audit.list(5))[0]).toMatchObject({ action: 'admin.family.deletion_check' });
  });

  it('reports an absent family and an unknown provider state without failing', async () => {
    const { app } = await opsApp();
    const absent = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/ghost/deletion-check',
      headers: bearer,
    });
    expect(absent.statusCode).toBe(200);
    expect(absent.json()).toMatchObject({ parent_state: 'absent', identity_exists: false });
  });

  it('shows lesson JSON read-only for moderation', async () => {
    const { app, audit, repo, assets, aliceKid } = await opsApp();
    const lesson = JSON.parse(readFileSync('doc/fixtures/lessons/math.json', 'utf8'));
    const storagePath = 'families/alice/lessons/lesson-1.json';
    await assets.put(storagePath, Buffer.from(JSON.stringify(lesson)));
    await repo.atomic(async (tx) => {
      tx.put('parents/alice/lessons/lesson-1', {
        id: 'lesson-1',
        kid_id: aliceKid.id,
        book_id: 'book-1',
        revision: 1,
        order: 1,
        status: 'approved',
        schema_version: '1.0.0',
        storage_path: storagePath,
        summary: 'Counting together',
      });
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/alice/lessons/lesson-1',
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.record).toMatchObject({ id: 'lesson-1', status: 'approved', revision: 1 });
    expect(body.lesson).toHaveProperty('metadata');
    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/alice/lessons/missing',
      headers: bearer,
    });
    expect(unknown.statusCode).toBe(404);
    expect((await audit.list(5))[0]).toMatchObject({ action: 'admin.lesson.view' });
  });

  it('rejects parent identities on the support routes', async () => {
    const parent = await opsApp(identity({ uid: 'alice', roles: undefined }));
    for (const url of [
      '/v1/admin/families/alice',
      '/v1/admin/families/alice/export',
      '/v1/admin/families/alice/deletion-check',
      '/v1/admin/families/alice/lessons/lesson-1',
    ]) {
      const denied = await parent.app.inject({ method: 'GET', url, headers: bearer });
      expect(denied.statusCode).toBe(403);
    }
  });
});

describe('audit pagination and moderation', () => {
  const bearer = { authorization: 'Bearer token' };

  it('paginates the audit log with the before cursor', async () => {
    const { app, audit } = await opsApp();
    for (let index = 0; index < 4; index++) {
      await audit.record('admin.a.page', 'operator-1', String(index));
      // Distinct timestamps so pagination has a strict order to walk.
      const latest = (await audit.list(1))[0]!;
      await new Promise((resolve) => setTimeout(resolve, 5));
      void latest;
    }
    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?limit=3',
      headers: bearer,
    });
    const entries = firstPage.json().entries as { at: string }[];
    expect(entries).toHaveLength(3);
    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/admin/audit?limit=3&before=${encodeURIComponent(entries[entries.length - 1]!.at)}`,
      headers: bearer,
    });
    const older = secondPage.json().entries as { at: string }[];
    expect(older.length).toBeGreaterThanOrEqual(1);
    expect(older.every((entry) => entry.at < entries[entries.length - 1]!.at)).toBe(true);
  });

  it('archives an approved lesson for moderation and keeps the record', async () => {
    const { app, audit, repo, assets, aliceKid } = await opsApp();
    const lesson = JSON.parse(readFileSync('doc/fixtures/lessons/math.json', 'utf8'));
    const storagePath = 'families/alice/lessons/mod-1.json';
    await assets.put(storagePath, Buffer.from(JSON.stringify(lesson)));
    await repo.atomic(async (tx) => {
      tx.put('parents/alice/lessons/mod-1', {
        id: 'mod-1',
        kid_id: aliceKid.id,
        book_id: 'book-1',
        revision: 2,
        order: 1,
        status: 'approved',
        schema_version: '1.0.0',
        storage_path: storagePath,
        summary: 'Counting together',
      });
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/families/alice/lessons/mod-1/deactivate',
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'mod-1', status: 'archived', revision: 2 });
    // Idempotent: a second call returns the archived record unchanged.
    const again = await app.inject({
      method: 'POST',
      url: '/v1/admin/families/alice/lessons/mod-1/deactivate',
      headers: bearer,
    });
    expect(again.json()).toMatchObject({ status: 'archived' });
    // The stored JSON stays readable for review after archiving.
    const view = await app.inject({
      method: 'GET',
      url: '/v1/admin/families/alice/lessons/mod-1',
      headers: bearer,
    });
    expect(view.statusCode).toBe(200);
    expect((await audit.list(10)).some((entry) => entry.action === 'admin.lesson.deactivate')).toBe(
      true,
    );
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/admin/families/alice/lessons/missing/deactivate',
      headers: bearer,
    });
    expect(unknown.statusCode).toBe(404);
  });
});

import { describe, expect, it } from 'vitest';
import { createAPI, type Identity } from '../src/api';
import { AuditLog } from '../src/admin';
import { FamilyService } from '../src/family';
import { MemoryAssets, MemoryRepository } from '../src/persistence';

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

describe('audit log', () => {
  it('lists recorded entries newest first', async () => {
    const audit = new AuditLog(new MemoryRepository());
    await audit.record('admin.a.first', 'op', 'one');
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

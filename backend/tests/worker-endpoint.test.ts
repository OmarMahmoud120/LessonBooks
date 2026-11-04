import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { CloudTasksOidcVerifier, createWorkerApp, EmulatorVerifier } from '../src/worker';
import { FamilyService } from '../src/family';
import { MemoryRepository, MemoryAssets } from '../src/persistence';
import { Pipeline } from '../src/pipeline';
import { FixtureIngestor } from '../src/ingest';
import { MockModelClient, RoutedAI, mockPolicy } from '../src/ai';
import { kidInput } from './family.test';

describe('private worker endpoint', () => {
  it('advances a claimed job with a valid bearer token and rejects others', async () => {
    const repo = new MemoryRepository();
    const family = new FamilyService(repo, new MemoryAssets());
    await family.ensureParent('alice');
    await family.consent('alice', 'privacy');
    await family.consent('alice', 'content_rights');
    const kid = await family.addKid('alice', kidInput);
    const { job_id } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 synthetic'),
      'endpoint-key-0001',
    );
    const pipeline = new Pipeline(
      family,
      new FixtureIngestor(),
      new RoutedAI(new MockModelClient(), mockPolicy),
    );
    const app = createWorkerApp(pipeline, new EmulatorVerifier('task-token'));
    const missing = await app.inject({ method: 'POST', url: `/v1/internal/jobs/alice/${job_id}` });
    expect(missing.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'POST',
      url: `/v1/internal/jobs/alice/${job_id}`,
      headers: { authorization: 'Bearer parent-token' },
    });
    expect(wrong.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/internal/jobs/alice/${job_id}`,
      headers: { authorization: 'Bearer task-token' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ran: true });
    const job = await repo.get<{ stage: string }>(familyPathJob('alice', job_id));
    expect(job?.stage).toBe('structure');
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/internal/jobs/alice/not%20a%20safe%20id',
      headers: { authorization: 'Bearer task-token' },
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
function familyPathJob(uid: string, id: string) {
  return `parents/${uid}/generation_jobs/${id}`;
}
describe('cloud tasks OIDC verifier', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key-1';
  function pem(pkey: typeof publicKey) {
    return pkey.export({ type: 'spki', format: 'pem' }).toString();
  }
  function signToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${body}`);
    const signature = signer.sign(privateKey).toString('base64url');
    return `${header}.${body}.${signature}`;
  }
  function verifierWith(audience: string, email: string) {
    return new CloudTasksOidcVerifier(audience, email, async () => ({ [kid]: pem(publicKey) }));
  }
  it('accepts a correctly signed task token', async () => {
    const token = signToken({
      aud: 'https://worker.example.run.app',
      email: 'worker@p.iam.gserviceaccount.com',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    await expect(
      verifierWith('https://worker.example.run.app', 'worker@p.iam.gserviceaccount.com').verify(
        token,
      ),
    ).resolves.toBeUndefined();
  });
  it('rejects malformed and unknown-key tokens', async () => {
    await expect(
      verifierWith('https://worker.example.run.app', 'worker@p.iam.gserviceaccount.com').verify(
        'not-a-jwt',
      ),
    ).rejects.toThrow('malformed_token');
    const badKid = signToken({
      aud: 'https://worker.example.run.app',
      email: 'worker@p.iam.gserviceaccount.com',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const foreign = new CloudTasksOidcVerifier(
      'https://worker.example.run.app',
      'worker@p.iam.gserviceaccount.com',
      async () => ({ other: pem(publicKey) }),
    );
    await expect(foreign.verify(badKid)).rejects.toThrow('unknown_key');
  });
  it.each([
    { aud: 'https://other.example.run.app', email: 'worker@p.iam.gserviceaccount.com' },
    { aud: 'https://worker.example.run.app', email: 'attacker@p.iam.gserviceaccount.com' },
    {
      aud: 'https://worker.example.run.app',
      email: 'worker@p.iam.gserviceaccount.com',
      exp: Math.floor(Date.now() / 1000) - 10,
    },
  ])('rejects mismatched audience, caller or expiry %j', async (payload) => {
    await expect(
      verifierWith('https://worker.example.run.app', 'worker@p.iam.gserviceaccount.com').verify(
        signToken(payload),
      ),
    ).rejects.toThrow();
  });
});

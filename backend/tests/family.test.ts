import { describe, it, expect } from 'vitest';
import { FamilyService } from '../src/family';
import { MemoryRepository, MemoryAssets } from '../src/persistence';
import { Pipeline } from '../src/pipeline';
import { FixtureIngestor } from '../src/ingest';
import { MockModelClient, RoutedAI, mockPolicy } from '../src/ai';
import { familyPath, type Job, type Kid, type LessonRecord, type Parent } from '../src/domain';
import { createAPI } from '../src/api';

export const kidInput: Omit<Kid, 'id' | 'state'> = {
  nickname: 'Fox',
  avatar: 'fox',
  age_band: '5-7',
  country: 'GB-ENG',
  language: 'en-GB',
  curriculum_id: 'england-national-2014',
  grade_id: 'year-1',
  reading_level: 'emerging',
};
export async function setup(overrides: Partial<Omit<Kid, 'id' | 'state'>> = {}) {
  const repo = new MemoryRepository();
  const assets = new MemoryAssets();
  const family = new FamilyService(repo, assets);
  await family.ensureParent('alice');
  await family.consent('alice', 'privacy');
  await family.consent('alice', 'content_rights');
  const kid = await family.addKid('alice', { ...kidInput, ...overrides });
  return { repo, assets, family, kid };
}
describe('family boundaries and generation', () => {
  it('retains a minimal deletion marker so stale authenticated requests cannot recreate accounts', async () => {
    const { family, repo } = await setup();
    await family.deleteAccount('alice');
    expect(await repo.get(familyPath('alice'))).toEqual({ id: 'alice', state: 'deleted' });
    await expect(family.ensureParent('alice')).rejects.toThrow('account_deleting');
    expect(await repo.list(familyPath('alice', 'consent_records'))).toHaveLength(0);
  });
  it('regenerates after a quality rejection and bounds repair attempts', async () => {
    const { family, kid, repo } = await setup();
    const { job_id } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 synthetic'),
      'quality-key-0001',
    );
    const base = new MockModelClient();
    let generations = 0;
    const client = {
      complete: async (request: Parameters<MockModelClient['complete']>[0]) => {
        const response = await base.complete(request);
        if (request.purpose === 'generate') generations++;
        if (request.purpose === 'validate')
          response.output = {
            safe: false,
            age_appropriate: true,
            reading_level_appropriate: true,
            answer_key_consistent: true,
          };
        return response;
      },
    };
    let clock = 0;
    const pipeline = new Pipeline(
      family,
      new FixtureIngestor(),
      new RoutedAI(client, mockPolicy),
      () => clock,
    );
    for (let i = 0; i < 20; i++) {
      await pipeline.run('alice', job_id);
      clock += 20000;
    }
    const job = await repo.get<Job>(familyPath('alice', 'generation_jobs', job_id));
    expect(job?.status).toBe('failed');
    expect(job?.repair_count).toBe(2);
    expect(generations).toBe(9);
    expect(await repo.list(familyPath('alice', 'lessons'))).toHaveLength(0);
  });
  it('requires consent, minimizes profile fields and rejects forged ownership', async () => {
    const { family } = await setup();
    await family.ensureParent('bob');
    await expect(family.addKid('bob', kidInput)).rejects.toThrow('consent_required');
    const app = await createAPI(family, async (token) => ({
      uid: token,
      auth_time: Date.now() / 1000,
    }));
    expect((await app.inject({ method: 'GET', url: '/v1/family' })).statusCode).toBe(401);
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/kids',
      headers: { authorization: 'Bearer bob' },
      payload: { ...kidInput, birth_year: 2019, parent_id: 'alice' },
    });
    expect(invalid.statusCode).toBe(400);
    const unsupported = await app.inject({
      method: 'POST',
      url: '/v1/kids',
      headers: { authorization: 'Bearer bob' },
      payload: { ...kidInput, language: 'fr' },
    });
    expect(unsupported.statusCode).toBe(400);
    const arabic = await app.inject({
      method: 'POST',
      url: '/v1/kids',
      headers: { authorization: 'Bearer bob' },
      payload: { ...kidInput, language: 'ar' },
    });
    expect(arabic.statusCode).toBe(409);
    await app.close();
  });
  it('makes upload idempotent and prevents other families using the kid', async () => {
    const { family, kid, repo } = await setup();
    const bytes = Buffer.from('%PDF-1.7 synthetic');
    const [a, b] = await Promise.all([
      family.upload('alice', kid.id, bytes, 'same-key-0001'),
      family.upload('alice', kid.id, bytes, 'same-key-0001'),
    ]);
    expect(a).toEqual(b);
    expect(await repo.list(familyPath('alice', 'books'))).toHaveLength(1);
    await expect(
      family.upload('alice', kid.id, Buffer.from('%PDF-1.7 different'), 'same-key-0001'),
    ).rejects.toThrow('idempotency_conflict');
    await family.ensureParent('bob');
    await expect(family.upload('bob', kid.id, bytes, 'other-key-0001')).rejects.toThrow(
      'kid_not_found',
    );
  });
  it('publishes exactly three drafts despite duplicate worker delivery and approves a revision', async () => {
    const { family, kid, repo } = await setup();
    const { job_id } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 synthetic'),
      'book-key-0001',
    );
    const pipeline = new Pipeline(
      family,
      new FixtureIngestor(),
      new RoutedAI(new MockModelClient(), mockPolicy),
    );
    for (let stage = 0; stage < 6; stage++)
      await Promise.all([pipeline.run('alice', job_id), pipeline.run('alice', job_id)]);
    const job = await repo.get<Job>(familyPath('alice', 'generation_jobs', job_id));
    expect(job?.status).toBe('completed');
    expect(job?.progress).toBe(100);
    expect(job?.usage.length).toBeGreaterThan(0);
    const lessons = await repo.list<LessonRecord>(familyPath('alice', 'lessons'));
    expect(lessons).toHaveLength(3);
    expect(lessons.every((l) => l.status === 'draft')).toBe(true);
    await expect(family.lesson('bob', lessons[0]!.id)).rejects.toThrow('lesson_not_found');
    await expect(family.approve('alice', lessons[0]!.id, 2)).rejects.toThrow('revision_conflict');
    expect((await family.approve('alice', lessons[0]!.id, 1)).status).toBe('approved');
    await pipeline.run('alice', job_id);
    expect(await repo.list(familyPath('alice', 'lessons'))).toHaveLength(3);
  });
  it('publishes three Arabic drafts with explicit language and direction', async () => {
    const { family, kid, repo, assets } = await setup({ language: 'ar' });
    const { job_id } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 synthetic'),
      'arabic-key-0001',
    );
    const pipeline = new Pipeline(
      family,
      new FixtureIngestor(),
      new RoutedAI(new MockModelClient(), mockPolicy),
    );
    for (let stage = 0; stage < 6; stage++) await pipeline.run('alice', job_id);
    const lessons = await repo.list<LessonRecord>(familyPath('alice', 'lessons'));
    expect(lessons).toHaveLength(3);
    for (const record of lessons) {
      const lesson = JSON.parse(Buffer.from(await assets.get(record.storage_path)).toString());
      expect(lesson.metadata.language).toBe('ar');
      expect(lesson.metadata.direction).toBe('rtl');
      expect(lesson.metadata.title).toHaveProperty('ar');
    }
  });
  it('keeps books and lessons scoped per kid and limits family size', async () => {
    const { family, kid, repo } = await setup();
    const second = await family.addKid('alice', { ...kidInput, nickname: 'Owl', avatar: 'owl' });
    await family.addKid('alice', { ...kidInput, nickname: 'Cat', avatar: 'cat' });
    await family.addKid('alice', { ...kidInput, nickname: 'Hawk', avatar: 'owl' });
    await expect(
      family.addKid('alice', { ...kidInput, nickname: 'Five', avatar: 'fox' }),
    ).rejects.toThrow('kid_limit_reached');
    const { job_id: jobA } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 first'),
      'kid-a-key-0001',
    );
    await family.upload('alice', second.id, Buffer.from('%PDF-1.7 second'), 'kid-b-key-0001');
    const books = await repo.list<{ kid_id: string }>(familyPath('alice', 'books'));
    expect(books.map((b) => b.kid_id).sort()).toEqual([kid.id, second.id].sort());
    const pipeline = new Pipeline(
      family,
      new FixtureIngestor(),
      new RoutedAI(new MockModelClient(), mockPolicy),
    );
    for (let stage = 0; stage < 6; stage++) await pipeline.run('alice', jobA);
    const lessons = await repo.list<LessonRecord>(familyPath('alice', 'lessons'));
    expect(lessons).toHaveLength(3);
    expect(lessons.every((lesson) => lesson.kid_id === kid.id)).toBe(true);
    await family.deleteKid('alice', kid.id);
    expect(await family.repo.get(familyPath('alice', 'kids', second.id))).toMatchObject({
      state: 'active',
    });
  });
  it('sets, verifies and rate-limits the parent PIN without leaking material', async () => {
    const { family, repo } = await setup();
    await expect(family.verifyPin('alice', '1234')).rejects.toThrow('pin_not_set');
    await family.setPin('alice', '1234');
    await expect(family.setPin('alice', 'abc')).rejects.toThrow('invalid_pin');
    const parent = await repo.get<Parent>(familyPath('alice'));
    expect(parent?.pin_hash).toMatch(/^[0-9a-f]{128}$/);
    expect(parent?.pin_hash).not.toContain('1234');
    await expect(family.verifyPin('alice', '9999')).rejects.toThrow('invalid_pin');
    await expect(family.verifyPin('alice', '1234')).resolves.toBeUndefined();
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(family.verifyPin('alice', '9999')).rejects.toThrow('invalid_pin');
    await expect(family.verifyPin('alice', '1234')).rejects.toThrow('pin_locked');
  });
  it('deletion wins over a worker that is still extracting content', async () => {
    const { family, kid, repo, assets } = await setup();
    const { job_id } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 synthetic'),
      'book-key-0002',
    );
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline = new Pipeline(
      family,
      {
        extract: async () => {
          entered();
          await waiting;
          return new FixtureIngestor().extract(new Uint8Array());
        },
      },
      new RoutedAI(new MockModelClient(), mockPolicy),
    );
    const run = pipeline.run('alice', job_id);
    await started;
    await family.deleteKid('alice', kid.id);
    release();
    await run;
    expect(await repo.list(familyPath('alice', 'lessons'))).toHaveLength(0);
    expect(await repo.get(familyPath('alice', 'generation_jobs', job_id))).toBeUndefined();
    expect(assets.objects.size).toBe(0);
  });
  it('bounds retries and preserves sanitized failure codes', async () => {
    const { family, kid, repo } = await setup();
    const { job_id } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 synthetic'),
      'book-key-0003',
    );
    let clock = 0;
    const pipeline = new Pipeline(
      family,
      {
        extract: async () => {
          throw new Error('private document text');
        },
      },
      new RoutedAI(new MockModelClient(), mockPolicy),
      () => clock,
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      await pipeline.run('alice', job_id);
      clock += 20000;
    }
    const job = await repo.get<Job>(familyPath('alice', 'generation_jobs', job_id));
    expect(job?.status).toBe('failed');
    expect(job?.attempt).toBe(3);
    expect(job?.error_code).toBe('generation_failed');
  });
});

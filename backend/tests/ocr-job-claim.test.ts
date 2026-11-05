import { expect, it } from 'vitest';
import { FamilyService } from '../src/family';
import { MemoryRepository, MemoryAssets } from '../src/persistence';
import { Pipeline } from '../src/pipeline';
import { MockModelClient, RoutedAI, mockPolicy } from '../src/ai';
import { FixtureIngestor, type Ingestor } from '../src/ingest';
import { familyPath, type Job, DomainError } from '../src/domain';
import { readFile, writeFile } from 'node:fs/promises';
import { createRuntimeIngestor } from '../src/runtime-ingestor';
import { runtimeConfig } from '../src/runtime-config';

async function setup(bytes = Buffer.from('%PDF-1.7 owned synthetic test')) {
  const repo = new MemoryRepository();
  const family = new FamilyService(repo, new MemoryAssets());
  await family.ensureParent('ocr-test');
  await family.consent('ocr-test', 'privacy');
  await family.consent('ocr-test', 'content_rights');
  const kid = await family.addKid('ocr-test', {
    nickname: 'Sample',
    avatar: 'owl',
    age_band: '5-7',
    country: 'GB-ENG',
    language: 'ar',
    curriculum_id: 'england-national-2014',
    grade_id: 'year-1',
    reading_level: 'emerging',
  });
  const { job_id } = await family.upload('ocr-test', kid.id, bytes, 'ocr-attempt-test');
  return { family, repo, kid, job_id, path: familyPath('ocr-test', 'generation_jobs', job_id) };
}
it('runs an owned Arabic PDF through the selected provider and persists usage with private drafts', async () => {
  const { family, repo, job_id, path } = await setup(
    await readFile('doc/fixtures/books/arabic-counting-scanned.pdf'),
  );
  const env = {
    OCR_PROVIDER: 'cloudflare',
    CLOUDFLARE_OCR_APPROVED: 'true',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_API_KEY: 'synthetic-token',
  };
  const png = await readFile('doc/fixtures/books/arabic-counting-vocalized.png');
  let sends = 0;
  const ingestor = createRuntimeIngestor(runtimeConfig(env), env, {
    run: async (command, args) => {
      if (command === 'pdftoppm') await writeFile(`${args.at(-1)}.png`, png);
      return '';
    },
    send: async () => {
      sends++;
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'واحد وواحد يساوي اثنين' } }],
        usage: { prompt_tokens: 366, completion_tokens: 636 },
      });
    },
  });
  const pipeline = new Pipeline(family, ingestor, new RoutedAI(new MockModelClient(), mockPolicy));
  expect(await pipeline.run('ocr-test', job_id)).toBe(true);
  const ingested = (await repo.get<Job>(path))!;
  expect(ingested.hosted_ocr_attempted).toBe(true);
  const state = JSON.parse(
    Buffer.from(await family.assets.get(ingested.output_path!)).toString('utf8'),
  );
  expect(state.extracted.ocr[0]).toMatchObject({
    provider: 'cloudflare',
    prompt_tokens: 366,
    completion_tokens: 636,
  });
  for (let stage = 0; stage < 5; stage++) expect(await pipeline.run('ocr-test', job_id)).toBe(true);
  expect((await repo.get<Job>(path))?.status).toBe('completed');
  expect(await repo.list(familyPath('ocr-test', 'lessons'))).toHaveLength(3);
  expect(sends).toBe(1);
});
it('persists the hosted attempt and refuses another send after downstream failure and worker restart', async () => {
  const { family, repo, job_id, path } = await setup();
  let sends = 0;
  const ingestor: Ingestor = {
    async extract(_bytes, _language, _sink, beforeHostedOCR) {
      await beforeHostedOCR!();
      sends++;
      throw new Error('simulated failure after provider response');
    },
  };
  let clock = 1;
  const makePipeline = () =>
    new Pipeline(family, ingestor, new RoutedAI(new MockModelClient(), mockPolicy), () => clock);
  expect(await makePipeline().run('ocr-test', job_id)).toBe(false);
  expect((await repo.get<Job>(path))?.hosted_ocr_attempted).toBe(true);
  clock += 20000;
  expect(await makePipeline().run('ocr-test', job_id)).toBe(false);
  expect(sends).toBe(1);
  expect(await repo.get<Job>(path)).toMatchObject({
    status: 'failed',
    error_code: 'ocr_already_attempted',
  });
});
it.each(['deleted', 'stale', 'expired'] as const)(
  'denies hosted authorization for a %s claim',
  async (kind) => {
    const { family, repo, kid, job_id, path } = await setup();
    let sends = 0;
    const ingestor: Ingestor = {
      async extract(_bytes, _language, _sink, beforeHostedOCR) {
        if (kind === 'deleted') await family.deleteKid('ocr-test', kid.id);
        else
          await repo.atomic(async (tx) => {
            const current = (await tx.get<Job>(path))!;
            tx.put(
              path,
              kind === 'stale'
                ? { ...current, fence: current.fence + 1 }
                : { ...current, lease_until: 0 },
            );
          });
        await beforeHostedOCR!();
        sends++;
        return new FixtureIngestor().extract(new Uint8Array(), 'ar');
      },
    };
    await new Pipeline(family, ingestor, new RoutedAI(new MockModelClient(), mockPolicy)).run(
      'ocr-test',
      job_id,
    );
    expect(sends).toBe(0);
  },
);
it('treats OCR transport failures as terminal instead of automatically spending on retries', async () => {
  const { family, repo, job_id, path } = await setup();
  let sends = 0;
  const ingestor: Ingestor = {
    async extract(_bytes, _language, _sink, beforeHostedOCR) {
      await beforeHostedOCR!();
      sends++;
      throw new DomainError('ocr_transport_failed');
    },
  };
  const pipeline = new Pipeline(family, ingestor, new RoutedAI(new MockModelClient(), mockPolicy));
  await pipeline.run('ocr-test', job_id);
  await pipeline.run('ocr-test', job_id);
  expect(sends).toBe(1);
  expect(await repo.get<Job>(path)).toMatchObject({
    status: 'failed',
    error_code: 'ocr_transport_failed',
  });
});

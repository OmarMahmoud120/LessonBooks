import { describe, expect, it } from 'vitest';
import { type TaskPublisher } from '../src/transport';
import { FamilyService } from '../src/family';
import { MemoryRepository, MemoryAssets } from '../src/persistence';
import { Pipeline } from '../src/pipeline';
import { FixtureIngestor } from '../src/ingest';
import { MockModelClient, RoutedAI, mockPolicy } from '../src/ai';
import { familyPath, type Job } from '../src/domain';
import { kidInput } from './family.test';

class RecordingPublisher implements TaskPublisher {
  readonly calls: { uid: string; jobId: string; token: string }[] = [];
  async enqueue(uid: string, jobId: string, token: string): Promise<void> {
    this.calls.push({ uid, jobId, token });
  }
}
async function setupFamily(publisher: TaskPublisher) {
  const repo = new MemoryRepository();
  const family = new FamilyService(repo, new MemoryAssets(), undefined, publisher);
  await family.ensureParent('alice');
  await family.consent('alice', 'privacy');
  await family.consent('alice', 'content_rights');
  const kid = await family.addKid('alice', kidInput);
  return { repo, family, kid };
}
describe('task dispatch', () => {
  it('enqueues once per new upload and not for idempotent repeats', async () => {
    const publisher = new RecordingPublisher();
    const { family, kid } = await setupFamily(publisher);
    const bytes = Buffer.from('%PDF-1.7 synthetic');
    await family.upload('alice', kid.id, bytes, 'dispatch-key-0001');
    await family.upload('alice', kid.id, bytes, 'dispatch-key-0001');
    expect(publisher.calls).toEqual([
      { uid: 'alice', jobId: expect.any(String), token: 'ingest:0:0' },
    ]);
  });
  it('enqueues the next stage after success and a fresh token after repair', async () => {
    const publisher = new RecordingPublisher();
    const { repo, family, kid } = await setupFamily(publisher);
    const { job_id } = await family.upload(
      'alice',
      kid.id,
      Buffer.from('%PDF-1.7 synthetic'),
      'stages-key-0001',
    );
    const base = new MockModelClient();
    let validations = 0;
    const client = {
      complete: async (request: Parameters<MockModelClient['complete']>[0]) => {
        const response = await base.complete(request);
        if (request.purpose === 'validate') {
          validations++;
          if (validations === 1)
            response.output = {
              safe: false,
              age_appropriate: true,
              reading_level_appropriate: true,
              answer_key_consistent: true,
            };
        }
        return response;
      },
    };
    let clock = 0;
    const pipeline = new Pipeline(
      family,
      new FixtureIngestor(),
      new RoutedAI(client, mockPolicy),
      () => clock,
      publisher,
    );
    for (let stage = 0; stage < 8; stage++) {
      await pipeline.run('alice', job_id);
      clock += 20000;
    }
    const tokens = publisher.calls.map((call) => call.token);
    expect(tokens.slice(0, 5)).toEqual([
      'ingest:0:0',
      'structure:0:1',
      'plan:0:2',
      'generate:0:3',
      'validate:0:4',
    ]);
    // First validation rejects; the repair path re-enters generate with a distinct token.
    expect(tokens[5]).toBe('generate:0:5');
    expect(tokens[6]).toBe('validate:0:6');
    const job = await repo.get<Job>(familyPath('alice', 'generation_jobs', job_id));
    expect(job?.status).toBe('completed');
  });
});

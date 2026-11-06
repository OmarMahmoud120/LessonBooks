import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { FamilyService } from '../src/family';
import { MemoryAssets, type Repository } from '../src/persistence';
import { PostgresRepository, type SqlPool } from '../src/persistence-postgres';

async function setup() {
  const db = newDb();
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool() as unknown as SqlPool;
  const repository = new PostgresRepository(pool);
  await repository.init();
  return { repository, pool };
}

let repository: PostgresRepository;

beforeEach(async () => {
  ({ repository } = await setup());
});

describe('PostgresRepository', () => {
  it('writes and reads documents by family path', async () => {
    await repository.atomic(async (tx) => {
      tx.put('parents/alice/kids/kid-1', { id: 'kid-1', nickname: 'Fox' });
    });
    expect(await repository.get('parents/alice/kids/kid-1')).toEqual({
      id: 'kid-1',
      nickname: 'Fox',
    });
    expect(await repository.get('parents/alice/kids/missing')).toBeUndefined();
  });

  it('lists only direct children of a collection', async () => {
    await repository.atomic(async (tx) => {
      tx.put('parents/alice/lessons/one', { id: 'one' });
      tx.put('parents/alice/lessons/two', { id: 'two' });
      tx.put('parents/alice/lessons/one/nested', { id: 'nested' });
      tx.put('parents/alice/books/one', { id: 'book' });
    });
    expect(await repository.list('parents/alice/lessons')).toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(await repository.list('parents/alice')).toEqual([]);
  });

  it('escapes wildcard characters in collection paths', async () => {
    await repository.atomic(async (tx) => {
      tx.put('parents/a_b/lessons/one', { id: 'underscore' });
      tx.put('parents/axb/lessons/one', { id: 'unrelated' });
      tx.put('parents/a%b/lessons/one', { id: 'percent' });
    });
    expect(await repository.list('parents/a_b/lessons')).toEqual([{ id: 'underscore' }]);
    expect(await repository.list('parents/a%b/lessons')).toEqual([{ id: 'percent' }]);
  });

  it('applies queued puts and deletes in one successful transaction', async () => {
    await repository.atomic(async (tx) => {
      tx.put('parents/alice/kids/kid-1', { nickname: 'Fox' });
      tx.put('parents/alice/kids/kid-2', { nickname: 'Owl' });
    });
    await repository.atomic(async (tx) => {
      tx.put('parents/alice/kids/kid-1', { nickname: 'Fox updated' });
      tx.delete('parents/alice/kids/kid-2');
      return 'done';
    });
    expect(await repository.get('parents/alice/kids/kid-1')).toEqual({
      nickname: 'Fox updated',
    });
    expect(await repository.get('parents/alice/kids/kid-2')).toBeUndefined();
  });

  it('discards queued writes when the transaction callback fails', async () => {
    await expect(
      repository.atomic(async (tx) => {
        tx.put('parents/alice/kids/kid-1', { nickname: 'Fox' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repository.get('parents/alice/kids/kid-1')).toBeUndefined();
  });

  it('keeps family and collection deletion scoped to the prefix', async () => {
    await repository.atomic(async (tx) => {
      tx.put('parents/alice/kids/kid-1', { id: 'alice-kid' });
      tx.put('parents/alice/lessons/one', { id: 'alice-lesson' });
      tx.put('parents/bob/kids/kid-1', { id: 'bob-kid' });
    });
    await repository.deleteTree('parents/alice/kids');
    expect(await repository.get('parents/alice/kids/kid-1')).toBeUndefined();
    expect(await repository.get('parents/alice/lessons/one')).toEqual({
      id: 'alice-lesson',
    });
    expect(await repository.get('parents/bob/kids/kid-1')).toEqual({ id: 'bob-kid' });
    await repository.deleteTree('parents/alice');
    expect(await repository.get('parents/alice/lessons/one')).toBeUndefined();
    expect(await repository.get('parents/bob/kids/kid-1')).toEqual({ id: 'bob-kid' });
  });
});

describe('FamilyService over Postgres', () => {
  it('creates and deletes family-scoped records through the adapter', async () => {
    const family = new FamilyService(repository as Repository, new MemoryAssets());
    await family.ensureParent('carol');
    await family.consent('carol', 'privacy');
    await family.consent('carol', 'content_rights');
    const kid = await family.addKid('carol', {
      nickname: 'Kestrel',
      avatar: 'fox',
      age_band: '5-7',
      country: 'GB-ENG',
      language: 'en-GB',
      curriculum_id: 'england-national-2014',
      grade_id: 'year-1',
      reading_level: 'emerging',
    });
    expect(await repository.get(`parents/carol/kids/${kid.id}`)).toMatchObject({
      nickname: 'Kestrel',
    });
    expect(await repository.list('parents/carol/kids')).toHaveLength(1);
    expect(await repository.list('parents/carol/consent_records')).toHaveLength(2);
    await family.deleteKid('carol', kid.id);
    expect(await repository.list('parents/carol/kids')).toHaveLength(0);
  });
});

describe('Postgres transaction control', () => {
  class FakePool {
    readonly statements: string[] = [];
    releases = 0;
    constructor(private commitFailures = 0) {}
    async query() {
      return { rows: [] };
    }
    async connect() {
      return {
        query: async (text: string) => {
          this.statements.push(text);
          if (text === 'COMMIT' && this.commitFailures > 0) {
            this.commitFailures--;
            const error = new Error('serialization failure') as Error & { code: string };
            error.code = '40001';
            throw error;
          }
          return { rows: [] };
        },
        release: () => {
          this.releases++;
        },
      };
    }
  }

  it('commits once and releases the connection', async () => {
    const pool = new FakePool();
    const repo = new PostgresRepository(pool as never);
    await repo.atomic(async (tx) => {
      tx.put('parents/alice/kids/kid-1', { id: 'kid-1' });
    });
    expect(pool.statements).toContain('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(pool.statements.at(-1)).toBe('COMMIT');
    expect(pool.statements.some((sql) => sql.startsWith('INSERT INTO documents'))).toBe(true);
    expect(pool.releases).toBe(1);
  });

  it('rolls back without writing when the callback fails', async () => {
    const pool = new FakePool();
    const repo = new PostgresRepository(pool as never);
    await expect(
      repo.atomic(async (tx) => {
        tx.put('parents/alice/kids/kid-1', { id: 'kid-1' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(pool.statements).toContain('ROLLBACK');
    expect(pool.statements.some((sql) => sql.startsWith('INSERT INTO documents'))).toBe(false);
    expect(pool.releases).toBe(1);
  });

  it('retries a serialization failure with a fresh transaction', async () => {
    const pool = new FakePool(1);
    const repo = new PostgresRepository(pool as never);
    await repo.atomic(async (tx) => {
      tx.put('parents/alice/kids/kid-1', { id: 'kid-1' });
    });
    expect(
      pool.statements.filter((sql) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE'),
    ).toHaveLength(2);
    expect(pool.statements.at(-1)).toBe('COMMIT');
    expect(pool.releases).toBe(2);
  });

  it('does not retry non-serialization failures', async () => {
    const pool = new FakePool();
    const failing = {
      async query() {
        return { rows: [] };
      },
      async connect() {
        return {
          query: async (text: string) => {
            pool.statements.push(text);
            if (text.startsWith('INSERT INTO documents')) throw new Error('disk full');
            return { rows: [] };
          },
          release: () => {
            pool.releases++;
          },
        };
      },
    };
    const repo = new PostgresRepository(failing as never);
    await expect(
      repo.atomic(async (tx) => {
        tx.put('parents/alice/kids/kid-1', { id: 'kid-1' });
      }),
    ).rejects.toThrow('disk full');
    expect(pool.statements.filter((sql) => sql.startsWith('BEGIN'))).toHaveLength(1);
    expect(pool.releases).toBe(1);
  });
});

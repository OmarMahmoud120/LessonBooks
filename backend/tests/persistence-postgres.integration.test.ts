import { describe, expect, it, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgresRepository } from '../src/persistence-postgres';

// Verifies the behaviors pg-mem cannot prove (ADR 0013 phase 1/4): real rollback,
// real serializable-conflict retries and real byte-level SQL semantics. Gated on
// POSTGRES_TEST_URL so ordinary runs never need a Postgres server; against the
// Compose stack: POSTGRES_TEST_URL=postgres://lessonbooks:<password>@127.0.0.1:5432/lessonbooks
const url = process.env.POSTGRES_TEST_URL;
const d = url ? describe : describe.skip;
const PREFIX = 'itest/';

d('PostgresRepository against real Postgres', () => {
  const pool = new Pool({ connectionString: url, max: 8 });
  const repo = new PostgresRepository(pool);
  const paths = () =>
    pool.query<{ path: string }>('SELECT path FROM documents WHERE path LIKE $1', [`${PREFIX}%`]);

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE path LIKE $1', [`${PREFIX}%`]);
    await pool.end();
  });

  it('creates its schema and starts empty for the test prefix', async () => {
    await repo.init();
    expect((await paths()).rowCount).toBe(0);
  });

  it('discards every write when the callback fails after writing', async () => {
    await expect(
      repo.atomic(async (tx) => {
        tx.put(`${PREFIX}rollback/kept`, { value: 1 });
        await repo.get(`${PREFIX}rollback/kept`); // reads must not force a commit
        tx.put(`${PREFIX}rollback/second`, { value: 2 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repo.get(`${PREFIX}rollback/kept`)).toBeUndefined();
    expect(await repo.get(`${PREFIX}rollback/second`)).toBeUndefined();
  });

  it('returns the callback result from a committed transaction', async () => {
    const result = await repo.atomic((tx) => {
      tx.put(`${PREFIX}result/entry`, { ok: true });
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(await repo.get(`${PREFIX}result/entry`)).toEqual({ ok: true });
  });

  it('retries serializable conflicts until every concurrent write commits', async () => {
    await repo.atomic((tx) => {
      tx.put(`${PREFIX}counter/value`, { count: 0 });
      return Promise.resolve();
    });
    // Concurrent read-modify-write transactions under SERIALIZABLE isolation force
    // real 40001 conflicts; the repository must retry each one instead of failing.
    const rounds = 8;
    await Promise.all(
      Array.from({ length: rounds }, () =>
        repo.atomic(async (tx) => {
          const current = await tx.get<{ count: number }>(`${PREFIX}counter/value`);
          tx.put(`${PREFIX}counter/value`, { count: (current?.count ?? 0) + 1 });
        }),
      ),
    );
    expect(await repo.get<{ count: number }>(`${PREFIX}counter/value`)).toEqual({
      count: rounds,
    });
  });

  it('round-trips byte-level content and path edge cases', async () => {
    const cases: [string, object][] = [
      [
        `${PREFIX}bytes/unicode`,
        { text: 'закладка — كتاب ✽ 📚', nested: { deep: [1, '٢', null] } },
      ],
      [`${PREFIX}bytes/wildcards%2Fand*stars`, { ok: '?/' }],
      [`${PREFIX}bytes/empty`, {}],
      [`${PREFIX}bytes/large`, { blob: 'x'.repeat(100_000) }],
    ];
    for (const [path, value] of cases)
      await repo.atomic((tx) => (tx.put(path, value), Promise.resolve()));
    for (const [path, value] of cases) expect(await repo.get(path)).toEqual(value);
    // jsonb key ordering and numeric handling must not corrupt reads.
    expect(await repo.get(`${PREFIX}bytes/empty`)).toEqual({});
  });

  it('lists only direct children even with deep descendants', async () => {
    await repo.atomic(async (tx) => {
      tx.put(`${PREFIX}listing/one`, { id: 'one' });
      tx.put(`${PREFIX}listing/two`, { id: 'two' });
      tx.put(`${PREFIX}listing/one/deep/three`, { id: 'three' });
    });
    const listed = await repo.list<{ id: string }>(`${PREFIX}listing`);
    expect(listed.map((entry) => entry.id).sort()).toEqual(['one', 'two']);
    // Deleting a tree removes the descendants but leaves siblings untouched.
    await repo.deleteTree(`${PREFIX}listing/one`);
    expect((await repo.list<{ id: string }>(`${PREFIX}listing`)).map((entry) => entry.id)).toEqual([
      'two',
    ]);
    expect(await repo.get(`${PREFIX}listing/one/deep/three`)).toBeUndefined();
  });
});

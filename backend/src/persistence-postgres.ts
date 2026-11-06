import type { QueryResultRow } from 'pg';
import type { Repository, Transaction } from './persistence';

// The adapter depends on a narrow SQL surface so tests can use an in-process
// Postgres without importing node-postgres internals.
export interface SqlClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface SqlConnection extends SqlClient {
  release(): void;
}
export interface SqlPool extends SqlClient {
  connect(): Promise<SqlConnection>;
}

const SERIALIZATION_FAILURES = new Set(['40001', '40P01']);
function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    SERIALIZATION_FAILURES.has(String((error as { code?: unknown }).code))
  );
}

type QueuedWrite = { path: string; value?: object };

// Allowed path characters are ASCII (safeId), so this upper bound is greater than any
// child segment while still using the primary-key btree for a prefix range scan.
function prefixRange(prefix: string): [string, string] {
  return [`${prefix}/`, `${prefix}/\uFFFF`];
}
function isDirectChild(path: string, collection: string) {
  const rest = path.slice(collection.length + 1);
  return path.startsWith(`${collection}/`) && rest.length > 0 && !rest.includes('/');
}
const DESCENDANTS = 'path >= $2 AND path < $3';
function listQuery() {
  return `SELECT path, data FROM documents WHERE path >= $1 AND path < $2`;
}

function transaction(client: SqlClient, writes: QueuedWrite[]): Transaction {
  return {
    get: async <T>(path: string) => {
      const result = await client.query<{ data: T }>('SELECT data FROM documents WHERE path = $1', [
        path,
      ]);
      return result.rows[0]?.data;
    },
    list: async <T>(path: string) => {
      const result = await client.query<{ path: string; data: T }>(listQuery(), prefixRange(path));
      return result.rows.filter((row) => isDirectChild(row.path, path)).map((row) => row.data);
    },
    put: <T extends object>(path: string, value: T) => {
      writes.push({ path, value });
    },
    delete: (path: string) => {
      writes.push({ path });
    },
  };
}

export class PostgresRepository implements Repository {
  constructor(
    private pool: SqlPool,
    private retries = 3,
  ) {}

  async init() {
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS documents (path text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())',
    );
  }

  async get<T>(path: string): Promise<T | undefined> {
    const result = await this.pool.query<{ data: T }>(
      'SELECT data FROM documents WHERE path = $1',
      [path],
    );
    return result.rows[0]?.data;
  }

  async list<T>(collection: string): Promise<T[]> {
    const result = await this.pool.query<{ path: string; data: T }>(
      listQuery(),
      prefixRange(collection),
    );
    return result.rows.filter((row) => isDirectChild(row.path, collection)).map((row) => row.data);
  }

  async atomic<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const writes: QueuedWrite[] = [];
        const result = await fn(transaction(client, writes));
        for (const write of writes) {
          if ('value' in write) {
            await client.query(
              'INSERT INTO documents (path, data) VALUES ($1, $2::jsonb) ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
              [write.path, JSON.stringify(write.value)],
            );
          } else {
            await client.query('DELETE FROM documents WHERE path = $1', [write.path]);
          }
        }
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (attempt < this.retries && isSerializationFailure(error)) continue;
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async deleteTree(path: string) {
    await this.pool.query(`DELETE FROM documents WHERE path = $1 OR (${DESCENDANTS})`, [
      path,
      ...prefixRange(path),
    ]);
  }
}

import { randomUUID } from 'node:crypto';
import type { Repository } from './persistence';

// Operator audit log (ADR 0016): one entry per admin action, written before the
// action is answered. The service exposes only record and list — no update or
// delete path exists, so the log is append-only by construction.
export type AuditEntry = {
  id: string;
  at: string;
  actor_uid: string;
  action: string;
  detail: string;
};

const AUDIT_PATH = 'audit_log';
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export class AuditLog {
  constructor(private repo: Repository) {}

  async record(action: string, actorUid: string, detail: string): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor_uid: actorUid,
      action,
      detail,
    };
    await this.repo.atomic(async (tx) => {
      tx.put(`${AUDIT_PATH}/${entry.id}`, entry);
    });
    return entry;
  }

  async list(limit: number): Promise<AuditEntry[]> {
    const bounded = Math.min(Math.max(Math.floor(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const entries = await this.repo.list<AuditEntry>(AUDIT_PATH);
    return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, bounded);
  }
}

import { randomUUID } from 'node:crypto';
import {
  DomainError,
  familyPath,
  type Job,
  type Kid,
  type LessonRecord,
  type Parent,
  type Usage,
} from './domain';
import type { Repository, Transaction } from './persistence';

// Operator audit log (ADR 0016): one entry per admin action, written before the
// action is answered. The service exposes only record and list — no update or
// delete path exists, so the log is append-only by construction. Retention is
// bounded: each write lazily prunes entries older than the window.
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
const RETENTION_DAYS = 400;
const MAX_PRUNES_PER_WRITE = 200;

export class AuditLog {
  constructor(private repo: Repository) {}

  // Writes the entry inside the caller's transaction so a mutating admin action
  // and its audit record commit atomically (privacy review M1).
  static recordInTx(tx: Transaction, action: string, actorUid: string, detail: string): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor_uid: actorUid,
      action,
      detail,
    };
    tx.put(`${AUDIT_PATH}/${entry.id}`, entry);
    return entry;
  }

  // Bounded retention prune shared by the write and read paths so the window is
  // enforced even if writes stop (privacy review M2).
  private static async pruneExpired(
    list: () => Promise<AuditEntry[]>,
    remove: (id: string) => Promise<void> | void,
  ) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    const expired = (await list())
      .filter((candidate) => candidate.at < cutoff)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, MAX_PRUNES_PER_WRITE);
    for (const stale of expired) await remove(stale.id);
  }

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
      await AuditLog.pruneExpired(
        () => tx.list<AuditEntry>(AUDIT_PATH),
        (id) => tx.delete(`${AUDIT_PATH}/${id}`),
      );
    });
    return entry;
  }

  async list(limit: number, before?: string): Promise<AuditEntry[]> {
    const bounded = Math.min(Math.max(Math.floor(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    await AuditLog.pruneExpired(
      () => this.repo.list<AuditEntry>(AUDIT_PATH),
      async (id) => {
        await this.repo.atomic(async (tx) => {
          tx.delete(`${AUDIT_PATH}/${id}`);
        });
      },
    );
    const entries = await this.repo.list<AuditEntry>(AUDIT_PATH);
    // `before` paginates: strictly older entries only, newest first.
    const visible = before ? entries.filter((entry) => entry.at < before) : entries;
    return visible.sort((a, b) => b.at.localeCompare(a.at)).slice(0, bounded);
  }
}

// Ops visibility (ADR 0016 phase B): reads and actions run through the same
// storage-agnostic Repository and FamilyService the family surface uses, so the
// monitor survives the Postgres cutover unchanged. Job and usage scans iterate
// families because jobs live under each family's path; the operator UI stays
// read-only over opaque identifiers.
export type AdminJobView = {
  id: string;
  family_uid: string;
  kid_id: string;
  book_id: string;
  stage: Job['stage'];
  status: Job['status'];
  progress: number;
  attempt: number;
  manual_retries: number;
  error_code: string | undefined;
  created_at: string;
};

export type UsageTotals = {
  per_model: {
    model: string;
    purpose: Usage['purpose'];
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  }[];
  totals: { calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number };
};

export class AdminOps {
  constructor(
    private repo: Repository,
    private families: {
      retryJob(
        uid: string,
        jobId: string,
        audit?: { action: string; actorUid: string },
      ): Promise<unknown>;
      lesson(uid: string, id: string): Promise<{ record: LessonRecord; lesson: unknown }>;
      deactivateLesson(
        uid: string,
        id: string,
        audit?: { action: string; actorUid: string },
      ): Promise<LessonRecord>;
    },
    private identityExists?: (uid: string) => Promise<boolean>,
  ) {}

  private async familyUids(): Promise<string[]> {
    const parents = await this.repo.list<Parent>('parents');
    return parents.map((parent) => parent.id);
  }

  async listJobs(limit: number, status?: Job['status']): Promise<AdminJobView[]> {
    const bounded = Math.min(Math.max(Math.floor(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const all: AdminJobView[] = [];
    for (const uid of await this.familyUids()) {
      for (const job of await this.repo.list<Job>(familyPath(uid, 'generation_jobs'))) {
        if (status && job.status !== status) continue;
        all.push({
          id: job.id,
          family_uid: uid,
          kid_id: job.kid_id,
          book_id: job.book_id,
          stage: job.stage,
          status: job.status,
          progress: job.progress,
          attempt: job.attempt,
          manual_retries: job.manual_retries ?? 0,
          error_code: job.error_code,
          created_at: job.created_at,
        });
      }
    }
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, bounded);
  }

  async retryJob(
    jobId: string,
    audit?: { action: string; actorUid: string },
  ): Promise<{ retried: true }> {
    for (const uid of await this.familyUids()) {
      const job = await this.repo.get<Job>(familyPath(uid, 'generation_jobs', jobId));
      if (job) {
        await this.families.retryJob(uid, jobId, audit);
        return { retried: true };
      }
    }
    throw new DomainError('job_not_found', 404);
  }

  async usageTotals(): Promise<UsageTotals> {
    const byKey = new Map<string, UsageTotals['per_model'][number]>();
    const totals = { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
    for (const uid of await this.familyUids()) {
      for (const job of await this.repo.list<Job>(familyPath(uid, 'generation_jobs'))) {
        for (const usage of job.usage) {
          const key = `${usage.model}:${usage.purpose}`;
          const entry = byKey.get(key) ?? {
            model: usage.model,
            purpose: usage.purpose,
            calls: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            cost_usd: 0,
          };
          entry.calls += 1;
          entry.prompt_tokens += usage.prompt_tokens;
          entry.completion_tokens += usage.completion_tokens;
          entry.cost_usd += usage.cost_usd;
          byKey.set(key, entry);
          totals.calls += 1;
          totals.prompt_tokens += usage.prompt_tokens;
          totals.completion_tokens += usage.completion_tokens;
          totals.cost_usd += usage.cost_usd;
        }
      }
    }
    return {
      per_model: [...byKey.values()].sort((a, b) =>
        `${a.model}:${a.purpose}`.localeCompare(`${b.model}:${b.purpose}`),
      ),
      totals,
    };
  }

  // Support and moderation (ADR 0016 phase C): lookups are by parent identifier,
  // never by child nickname, and never create state. The parent credential hash
  // never leaves the server.
  // Minimization (privacy review): no PIN credential metadata leaves the server.
  private static parentView(parent: Parent) {
    const view: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parent))
      if (!key.startsWith('pin_')) view[key] = value;
    view.pin_set = Boolean(parent.pin_hash);
    return view as Parent & { pin_set: boolean };
  }

  private static familyCollections = [
    'kids',
    'consent_records',
    'books',
    'generation_jobs',
    'lessons',
    'assignments',
    'progress_events',
    'lesson_results',
  ] as const;

  private async parentDoc(uid: string): Promise<Parent> {
    const parent = await this.repo.get<Parent>(familyPath(uid));
    if (!parent) throw new DomainError('family_not_found', 404);
    return parent;
  }

  async familyOverview(uid: string) {
    const parent = await this.parentDoc(uid);
    const kids = await this.repo.list<Kid>(familyPath(uid, 'kids'));
    const consents = await this.repo.list(familyPath(uid, 'consent_records'));
    return {
      parent: AdminOps.parentView(parent),
      // Minimization: identifiers and state only; nicknames stay out of operator
      // responses (privacy review L4).
      kids: kids.map((kid) => ({
        id: kid.id,
        avatar: kid.avatar,
        state: kid.state,
      })),
      consents: consents.map((consent) => ({
        type: (consent as { type?: string }).type,
        granted_at: (consent as { granted_at?: string }).granted_at,
      })),
    };
  }

  async exportFamily(uid: string) {
    const parent = await this.parentDoc(uid);
    const collections: Record<string, unknown[]> = {};
    for (const name of AdminOps.familyCollections)
      collections[name] = await this.repo.list(familyPath(uid, name));
    return { parent: AdminOps.parentView(parent), ...collections };
  }

  async deletionCheck(uid: string) {
    const parent = await this.repo.get<Parent>(familyPath(uid));
    const counts: Record<string, number> = {};
    for (const name of AdminOps.familyCollections)
      counts[name] = (await this.repo.list(familyPath(uid, name))).length;
    let identity_exists: boolean | null = null;
    if (this.identityExists) {
      try {
        identity_exists = await this.identityExists(uid);
      } catch {
        identity_exists = null;
      }
    }
    return {
      parent_state: parent?.state ?? 'absent',
      counts,
      identity_exists,
    };
  }

  async lessonView(uid: string, lessonId: string) {
    const { record, lesson } = await this.families.lesson(uid, lessonId);
    return { record, lesson };
  }

  async deactivateLesson(
    uid: string,
    lessonId: string,
    audit?: { action: string; actorUid: string },
  ) {
    return this.families.deactivateLesson(uid, lessonId, audit);
  }
}

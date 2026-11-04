import { randomUUID, createHash } from 'node:crypto';
import type { Assets, Repository, Transaction } from './persistence';
import {
  DomainError,
  familyPath,
  type Parent,
  type Kid,
  type Consent,
  type Book,
  type Job,
  type LessonRecord,
} from './domain';
import { assertLesson } from '@lessonbooks/contracts';
import { noopPublisher, type TaskPublisher } from './transport';

export class FamilyService {
  constructor(
    readonly repo: Repository,
    readonly assets: Assets,
    private deleteIdentity: (uid: string) => Promise<void> = async () => {},
    private publisher: TaskPublisher = noopPublisher,
  ) {}
  async ensureParent(uid: string) {
    return this.repo.atomic(async (tx) => {
      const path = familyPath(uid);
      const current = await tx.get<Parent>(path);
      if (current && current.state !== 'active') throw new DomainError('account_deleting', 409);
      const parent: Parent = current ?? {
        id: uid,
        state: 'active',
        preferred_language: 'en-GB',
        country: 'GB-ENG',
        created_at: new Date().toISOString(),
      };
      if (!current) tx.put(path, parent);
      return parent;
    });
  }
  async active(tx: Transaction, uid: string, kidId?: string) {
    const parent = await tx.get<Parent>(familyPath(uid));
    if (!parent || parent.state !== 'active') throw new DomainError('family_unavailable', 409);
    if (kidId) {
      const kid = await tx.get<Kid>(familyPath(uid, 'kids', kidId));
      if (!kid || kid.state !== 'active') throw new DomainError('kid_not_found', 404);
    }
  }
  async overview(uid: string) {
    const parent = await this.ensureParent(uid);
    return {
      parent,
      kids: await this.repo.list<Kid>(familyPath(uid, 'kids')),
      consents: await this.repo.list<Consent>(familyPath(uid, 'consent_records')),
    };
  }
  async consent(uid: string, type: Consent['type']) {
    const value: Consent = {
      id: `${type}-2026-11-03`,
      type,
      version: '2026-11-03',
      method: 'parent_confirmation',
      granted_at: new Date().toISOString(),
    };
    await this.repo.atomic(async (tx) => {
      await this.active(tx, uid);
      tx.put(familyPath(uid, 'consent_records', value.id), value);
    });
    return value;
  }
  async addKid(uid: string, input: Omit<Kid, 'id' | 'state'>) {
    const kid: Kid = { ...input, id: randomUUID(), state: 'active' };
    await this.repo.atomic(async (tx) => {
      const parent = await tx.get<Parent>(familyPath(uid));
      const consent = await tx.get<Consent>(
        familyPath(uid, 'consent_records', 'privacy-2026-11-03'),
      );
      if (!parent || parent.state !== 'active') throw new DomainError('family_unavailable', 409);
      if (!consent) throw new DomainError('consent_required', 409);
      const kids = await tx.list(familyPath(uid, 'kids'));
      if (kids.length >= 4) throw new DomainError('kid_limit_reached', 409);
      tx.put(familyPath(uid, 'kids', kid.id), kid);
    });
    return kid;
  }
  async upload(uid: string, kidId: string, bytes: Uint8Array, key: string) {
    if (
      bytes.length < 8 ||
      bytes.length > 15 * 1024 * 1024 ||
      !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('%PDF-'))
    )
      throw new DomainError('invalid_pdf');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new DomainError('invalid_idempotency_key');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const id = createHash('sha256').update(`${uid}:${key}`).digest('hex').slice(0, 32);
    const source = `families/${uid}/kids/${kidId}/books/${id}/${digest}/source.pdf`;
    const existing = await this.repo.get<Book>(familyPath(uid, 'books', id));
    if (existing && (existing.sha256 !== digest || existing.kid_id !== kidId))
      throw new DomainError('idempotency_conflict', 409);
    const kid = await this.repo.get<Kid>(familyPath(uid, 'kids', kidId));
    if (!kid || kid.state !== 'active') throw new DomainError('kid_not_found', 404);
    const book: Book = {
      id,
      kid_id: kidId,
      subject: 'mathematics',
      language: kid.language,
      source_path: source,
      sha256: digest,
      status: 'uploaded',
      created_at: new Date().toISOString(),
    };
    const job: Job = {
      id,
      book_id: id,
      kid_id: kidId,
      stage: 'ingest',
      status: 'queued',
      progress: 0,
      attempt: 0,
      fence: 0,
      lease_until: 0,
      next_attempt_at: 0,
      created_at: book.created_at,
      usage: [],
      budget_usd: 0,
      reserved_usd: 0,
      repair_count: 0,
      prompt_version: '1',
      policy_version: '1',
      outbox_pending: true,
    };
    await this.repo.atomic(async (tx) => {
      await this.active(tx, uid, kidId);
      if (!(await tx.get<Consent>(familyPath(uid, 'consent_records', 'content_rights-2026-11-03'))))
        throw new DomainError('content_rights_required', 409);
    });
    await this.assets.put(source, bytes, 'application/pdf');
    try {
      const created = await this.repo.atomic(async (tx) => {
        await this.active(tx, uid, kidId);
        const current = await tx.get<Book>(familyPath(uid, 'books', id));
        if (current) {
          if (current.sha256 !== digest || current.kid_id !== kidId)
            throw new DomainError('idempotency_conflict', 409);
          return { book_id: id, job_id: id, dispatch: false };
        }
        tx.put(familyPath(uid, 'books', id), book);
        tx.put(familyPath(uid, 'generation_jobs', id), job);
        return { book_id: id, job_id: id, dispatch: true };
      });
      // Lost dispatch is recovered by the outbox sweeper; enqueue failure keeps the flag set.
      if (created.dispatch)
        await this.publisher.enqueue(uid, id, 'ingest:0:0').catch((error) => {
          console.error('dispatch_enqueue_failed', error);
        });
      return { book_id: created.book_id, job_id: created.job_id };
    } catch (error) {
      // A concurrent deletion wins; remove the just-written source after failed ownership recheck.
      const retained = await this.repo.get<Book>(familyPath(uid, 'books', id));
      if (!retained || retained.source_path !== source) await this.assets.deletePrefix(source);
      throw error;
    }
  }
  async lesson(uid: string, id: string) {
    const record = await this.repo.get<LessonRecord>(familyPath(uid, 'lessons', id));
    if (!record) throw new DomainError('lesson_not_found', 404);
    await this.repo.atomic((tx) => this.active(tx, uid, record.kid_id));
    const value: unknown = JSON.parse(
      Buffer.from(await this.assets.get(record.storage_path)).toString('utf8'),
    );
    assertLesson(value);
    return { record, lesson: value };
  }
  async approve(uid: string, id: string, revision: number) {
    return this.repo.atomic(async (tx) => {
      const path = familyPath(uid, 'lessons', id);
      const lesson = await tx.get<LessonRecord>(path);
      if (!lesson) throw new DomainError('lesson_not_found', 404);
      await this.active(tx, uid, lesson.kid_id);
      if (lesson.revision !== revision || lesson.status === 'archived')
        throw new DomainError('revision_conflict', 409);
      const approved: LessonRecord = {
        ...lesson,
        status: 'approved',
        approved_at: new Date().toISOString(),
      };
      tx.put(path, approved);
      return approved;
    });
  }
  async deleteKid(uid: string, kidId: string) {
    await this.repo.atomic(async (tx) => {
      const parent = await tx.get<Parent>(familyPath(uid));
      const kid = await tx.get<Kid>(familyPath(uid, 'kids', kidId));
      if (!parent) throw new DomainError('not_found', 404);
      if (kid) tx.put(familyPath(uid, 'kids', kidId), { ...kid, state: 'deleting' });
    });
    // Tombstone remains until all objects and documents have been removed.
    const collections = [
      'generation_jobs',
      'lessons',
      'books',
      'assignments',
      'progress_events',
      'lesson_results',
    ];
    for (const collection of collections) {
      for (const record of await this.repo.list<{ id: string; kid_id: string }>(
        familyPath(uid, collection),
      )) {
        if (record.kid_id === kidId)
          await this.repo.deleteTree(familyPath(uid, collection, record.id));
      }
    }
    await this.assets.deletePrefix(`families/${uid}/kids/${kidId}/`);
    await this.repo.atomic(async (tx) => {
      tx.delete(familyPath(uid, 'kids', kidId));
    });
  }
  async deleteAccount(uid: string) {
    await this.repo.atomic(async (tx) => {
      const parent = await tx.get<Parent>(familyPath(uid));
      if (parent) tx.put(familyPath(uid), { ...parent, state: 'deleting' });
    });
    for (const kid of await this.repo.list<Kid>(familyPath(uid, 'kids')))
      await this.deleteKid(uid, kid.id);
    await this.assets.deletePrefix(`families/${uid}/`);
    // Erase child collections before removing Auth. A minimized tombstone prevents
    // already-authenticated requests from recreating a deleted account.
    for (const collection of [
      'consent_records',
      'books',
      'generation_jobs',
      'lessons',
      'assignments',
      'progress_events',
      'lesson_results',
    ]) {
      for (const record of await this.repo.list<{ id: string }>(familyPath(uid, collection)))
        await this.repo.deleteTree(familyPath(uid, collection, record.id));
    }
    await this.deleteIdentity(uid);
    await this.repo.atomic(async (tx) => {
      await tx.get(familyPath(uid));
      tx.put(familyPath(uid), { id: uid, state: 'deleted' });
    });
  }
}

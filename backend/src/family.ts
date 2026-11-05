import { randomUUID, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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
  type Assignment,
  type ProgressEvent,
} from './domain';
import { assertLesson, assertEvent, type LessonEvent } from '@lessonbooks/contracts';
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
  // The PIN guards the parent tools only; child play stays open and no child identity exists.
  async setPin(uid: string, pin: string) {
    if (!/^[0-9]{4,8}$/.test(pin)) throw new DomainError('invalid_pin');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(pin, salt, 64).toString('hex');
    await this.repo.atomic(async (tx) => {
      const parent = await tx.get<Parent>(familyPath(uid));
      if (!parent || parent.state !== 'active') throw new DomainError('family_unavailable', 409);
      tx.put(familyPath(uid), {
        ...parent,
        pin_hash: hash,
        pin_salt: salt,
        pin_updated_at: new Date().toISOString(),
        pin_failed_count: 0,
        pin_locked_until: 0,
      });
    });
  }
  async verifyPin(uid: string, pin: string, now = Date.now) {
    if (!/^[0-9]{4,8}$/.test(pin)) throw new DomainError('invalid_pin', 401);
    const outcome = await this.repo.atomic(async (tx) => {
      const parent = await tx.get<Parent>(familyPath(uid));
      if (!parent?.pin_hash || !parent.pin_salt) throw new DomainError('pin_not_set', 404);
      if ((parent.pin_locked_until ?? 0) > now()) throw new DomainError('pin_locked', 429);
      const attempt = scryptSync(pin, parent.pin_salt, 64);
      const stored = Buffer.from(parent.pin_hash, 'hex');
      const matches = attempt.length === stored.length && timingSafeEqual(attempt, stored);
      if (matches) {
        tx.put(familyPath(uid), { ...parent, pin_failed_count: 0, pin_locked_until: 0 });
        return true;
      }
      const failedCount = (parent.pin_failed_count ?? 0) + 1;
      tx.put(familyPath(uid), {
        ...parent,
        pin_failed_count: failedCount,
        pin_locked_until: failedCount >= 5 ? now() + 300000 : 0,
      });
      return false;
    });
    if (!outcome) throw new DomainError('invalid_pin', 401);
  }
  // Assignments pin the approved revision at assign time; only approved lessons qualify.
  async assign(uid: string, kidId: string, lessonId: string) {
    return this.repo.atomic(async (tx) => {
      await this.active(tx, uid, kidId);
      const record = await tx.get<LessonRecord>(familyPath(uid, 'lessons', lessonId));
      if (!record || record.kid_id !== kidId) throw new DomainError('lesson_not_found', 404);
      if (record.status !== 'approved') throw new DomainError('lesson_not_approved', 409);
      const existing = await tx.list<Assignment>(familyPath(uid, 'assignments'));
      if (existing.some((a) => a.lesson_id === lessonId && a.kid_id === kidId))
        throw new DomainError('assignment_exists', 409);
      const assignment: Assignment = {
        id: randomUUID(),
        kid_id: kidId,
        lesson_id: lessonId,
        revision: record.revision,
        assigned_by: uid,
        assigned_at: new Date().toISOString(),
      };
      tx.put(familyPath(uid, 'assignments', assignment.id), assignment);
      return assignment;
    });
  }
  async unassign(uid: string, assignmentId: string) {
    await this.repo.atomic(async (tx) => {
      const assignment = await tx.get<Assignment>(familyPath(uid, 'assignments', assignmentId));
      if (!assignment) throw new DomainError('assignment_not_found', 404);
      await this.active(tx, uid, assignment.kid_id);
      tx.delete(familyPath(uid, 'assignments', assignmentId));
    });
    return { deleted: true };
  }
  async listAssignments(uid: string) {
    await this.repo.atomic(async (tx) => this.active(tx, uid));
    return this.repo.list<Assignment>(familyPath(uid, 'assignments'));
  }
  // Queued play events: validated against the generated event contract, ownership derived
  // from the lesson record (never the request), deduplicated by event_id.
  async recordEvents(uid: string, input: unknown[]) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 50)
      throw new DomainError('invalid_event_batch');
    const events: LessonEvent[] = [];
    for (const raw of input) {
      try {
        assertEvent(raw);
      } catch {
        throw new DomainError('invalid_event');
      }
      events.push(raw as LessonEvent);
    }
    return this.repo.atomic(async (tx) => {
      let accepted = 0;
      for (const event of events) {
        const record = await tx.get<LessonRecord>(familyPath(uid, 'lessons', event.lesson_id));
        if (!record) throw new DomainError('lesson_not_found', 404);
        if (record.revision !== event.lesson_revision)
          throw new DomainError('revision_mismatch', 409);
        await this.active(tx, uid, record.kid_id);
        const path = familyPath(uid, 'progress_events', event.event_id);
        if (await tx.get(path)) continue;
        const stored: ProgressEvent = {
          event_id: event.event_id,
          kid_id: record.kid_id,
          lesson_id: event.lesson_id,
          revision: event.lesson_revision,
          type: event.type,
          client_at: event.timestamp,
          received_at: new Date().toISOString(),
        };
        if (event.activity_id !== undefined) stored.activity_id = event.activity_id;
        if (event.score !== undefined) stored.score = event.score;
        if (event.max_score !== undefined) stored.max_score = event.max_score;
        if (event.duration_ms !== undefined) stored.duration_ms = event.duration_ms;
        tx.put(path, stored);
        accepted++;
      }
      return { accepted };
    });
  }
  // Parent dashboard aggregation: per-lesson play counts, scores and last-played time.
  async progress(uid: string, kidId: string) {
    await this.repo.atomic((tx) => this.active(tx, uid, kidId));
    const events = await this.repo.list<ProgressEvent>(familyPath(uid, 'progress_events'));
    const byLesson = new Map<
      string,
      {
        lesson_id: string;
        started: number;
        completed: number;
        score: number;
        max_score: number;
        last_client_at: string;
      }
    >();
    for (const event of events) {
      if (event.kid_id !== kidId) continue;
      const entry = byLesson.get(event.lesson_id) ?? {
        lesson_id: event.lesson_id,
        started: 0,
        completed: 0,
        score: 0,
        max_score: 0,
        last_client_at: '',
      };
      if (event.type === 'started') entry.started++;
      if (event.type === 'completed') entry.completed++;
      if (event.type === 'score') {
        entry.score += event.score ?? 0;
        entry.max_score += event.max_score ?? 0;
      }
      if (event.client_at > entry.last_client_at) entry.last_client_at = event.client_at;
      byLesson.set(event.lesson_id, entry);
    }
    return { kid_id: kidId, lessons: [...byLesson.values()] };
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
  // Parent-triggered retry of a failed generation: clears stage progress by restarting at
  // ingest (every stage overwrites its state slice in order) with a fresh fence so stale
  // workers cannot commit, and stays bounded.
  async retryJob(uid: string, jobId: string) {
    return this.repo.atomic(async (tx) => {
      const path = familyPath(uid, 'generation_jobs', jobId);
      const job = await tx.get<Job>(path);
      if (!job) throw new DomainError('job_not_found', 404);
      await this.active(tx, uid, job.kid_id);
      if (job.status !== 'failed') throw new DomainError('retry_not_allowed', 409);
      if ((job.manual_retries ?? 0) >= 2) throw new DomainError('retry_limit_reached', 409);
      const bookPath = familyPath(uid, 'books', job.book_id);
      const book = await tx.get<Book>(bookPath);
      if (book && book.status === 'failed') tx.put(bookPath, { ...book, status: 'processing' });
      const next: Job = {
        ...job,
        stage: 'ingest',
        status: 'queued',
        progress: 0,
        attempt: 0,
        fence: job.fence + 1,
        lease_until: 0,
        next_attempt_at: 0,
        manual_retries: (job.manual_retries ?? 0) + 1,
        outbox_pending: true,
      };
      delete next.error_code;
      tx.put(path, next);
      return { retried: true };
    });
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

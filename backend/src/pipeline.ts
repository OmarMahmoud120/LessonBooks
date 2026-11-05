import { stageFunctions } from './stages';
import { randomUUID } from 'node:crypto';
import { assertLesson, textFor, type Lesson } from '@lessonbooks/contracts';
import {
  DomainError,
  familyPath,
  STAGES,
  type Job,
  type Book,
  type Kid,
  type LessonRecord,
  type Usage,
} from './domain';
import { FamilyService } from './family';
import type { Ingestor, ExtractedBook } from './ingest';
import { RoutedAI, type Accounting } from './ai';
import { noopPublisher, type TaskPublisher } from './transport';

export type Topic = { id: string; title: string; source_pages: number[] };
export type Outline = { id: string; title: string };
export type StageState = {
  extracted?: ExtractedBook;
  topics?: Topic[];
  outlines?: Outline[];
  lessons?: Lesson[];
};
export class Pipeline {
  constructor(
    private families: FamilyService,
    private ingestor: Ingestor,
    private ai: RoutedAI,
    private now = Date.now,
    private publisher: TaskPublisher = noopPublisher,
  ) {}
  // Lost dispatch is recovered by the outbox sweeper; enqueue failure keeps the flag set.
  private dispatch(uid: string, job: Job, token: string): void {
    void this.publisher.enqueue(uid, job.id, token).catch((error) => {
      console.error('dispatch_enqueue_failed', error);
    });
  }
  private async claim(uid: string, id: string): Promise<Job | undefined> {
    return this.families.repo.atomic(async (tx) => {
      const path = familyPath(uid, 'generation_jobs', id);
      const job = await tx.get<Job>(path);
      if (
        !job ||
        ['completed', 'failed', 'cancelled'].includes(job.status) ||
        job.lease_until > this.now() ||
        job.next_attempt_at > this.now()
      )
        return;
      await this.families.active(tx, uid, job.kid_id);
      if (job.attempt >= 3) {
        tx.put(path, {
          ...job,
          status: 'failed',
          error_code: 'retry_exhausted',
          outbox_pending: false,
        });
        return;
      }
      const claimed: Job = {
        ...job,
        status: 'running',
        attempt: job.attempt + 1,
        fence: job.fence + 1,
        lease_until: this.now() + 10 * 60 * 1000,
        outbox_pending: false,
      };
      tx.put(path, claimed);
      return claimed;
    });
  }
  private accounting(uid: string, job: Job): Accounting {
    const update = async (fn: (current: Job) => Job) =>
      this.families.repo.atomic(async (tx) => {
        const path = familyPath(uid, 'generation_jobs', job.id);
        const current = await tx.get<Job>(path);
        await this.families.active(tx, uid, job.kid_id);
        if (!current || current.fence !== job.fence || current.status !== 'running')
          throw new DomainError('stale_worker');
        tx.put(path, fn(current));
      });
    return {
      reserve: async (amount) =>
        update((current) => {
          if (
            !Number.isFinite(amount) ||
            amount < 0 ||
            current.usage.reduce((s, u) => s + u.cost_usd, 0) + current.reserved_usd + amount >
              current.budget_usd
          )
            throw new DomainError('budget_exceeded');
          return { ...current, reserved_usd: current.reserved_usd + amount };
        }),
      settle: async (reserved: number, usage: Usage) =>
        update((current) => ({
          ...current,
          reserved_usd: Math.max(0, current.reserved_usd - reserved),
          usage: [...current.usage, usage],
        })),
    };
  }
  async run(uid: string, id: string): Promise<boolean> {
    const job = await this.claim(uid, id);
    if (!job) return false;
    const family = this.families;
    let attemptPath: string | undefined;
    try {
      const book = await family.repo.get<Book>(familyPath(uid, 'books', job.book_id));
      const kid = await family.repo.get<Kid>(familyPath(uid, 'kids', job.kid_id));
      if (!book || !kid || book.kid_id !== kid.id) throw new DomainError('invalid_job_references');
      const state: StageState = job.output_path
        ? (JSON.parse(
            Buffer.from(await family.assets.get(job.output_path)).toString('utf8'),
          ) as StageState)
        : {};
      const account = this.accounting(uid, job);
      await stageFunctions[job.stage]({
        state,
        job,
        kid,
        book,
        family,
        account,
        ingestor: this.ingestor,
        beforeHostedOCR: () =>
          family.repo.atomic(async (tx) => {
            const path = familyPath(uid, 'generation_jobs', job.id);
            const current = await tx.get<Job>(path);
            await family.active(tx, uid, job.kid_id);
            if (
              !current ||
              current.status !== 'running' ||
              current.fence !== job.fence ||
              current.stage !== 'ingest' ||
              current.lease_until <= this.now()
            )
              throw new DomainError('ocr_stale_worker');
            if (current.hosted_ocr_attempted) throw new DomainError('ocr_already_attempted');
            tx.put(path, { ...current, hosted_ocr_attempted: true });
          }),
        ai: this.ai,
      });
      attemptPath = `families/${uid}/kids/${job.kid_id}/jobs/${job.id}/${job.fence}-${randomUUID()}/`;
      const outputPath = attemptPath + 'state.json';
      await family.assets.put(outputPath, Buffer.from(JSON.stringify(state)), 'application/json');
      const published: LessonRecord[] = [];
      if (job.stage === 'publish') {
        if (!state.lessons || state.lessons.length < 3 || state.lessons.length > 5)
          throw new DomainError('invalid_lesson_count');
        for (const [index, lesson] of state.lessons.entries()) {
          assertLesson(lesson);
          const storage = `${attemptPath}${lesson.id}.json`;
          await family.assets.put(storage, Buffer.from(JSON.stringify(lesson)), 'application/json');
          published.push({
            id: lesson.id,
            kid_id: kid.id,
            book_id: book.id,
            revision: 1,
            order: index + 1,
            status: 'draft',
            schema_version: '1.0.0',
            storage_path: storage,
            summary: textFor(lesson.metadata.title, kid.language),
          });
        }
      }
      const outcome = await family.repo.atomic(async (tx) => {
        const path = familyPath(uid, 'generation_jobs', id);
        const current = await tx.get<Job>(path);
        await family.active(tx, uid, job.kid_id);
        if (!current || current.fence !== job.fence || current.status !== 'running')
          throw new DomainError('stale_worker');
        const nextIndex = STAGES.indexOf(job.stage) + 1;
        const complete = nextIndex === STAGES.length;
        const nextStage = STAGES[nextIndex] ?? 'publish';
        const next: Job = {
          ...current,
          stage: nextStage,
          status: complete ? 'completed' : 'queued',
          progress: Math.round((nextIndex / STAGES.length) * 100),
          attempt: 0,
          lease_until: 0,
          next_attempt_at: 0,
          output_path: outputPath,
          outbox_pending: !complete,
        };
        delete next.error_code;
        tx.put(path, next);
        tx.put(familyPath(uid, 'books', book.id), {
          ...book,
          status: complete ? 'ready' : 'processing',
        });
        for (const record of published) tx.put(familyPath(uid, 'lessons', record.id), record);
        return { nextStage, complete };
      });
      if (outcome && !outcome.complete)
        this.dispatch(uid, job, `${outcome.nextStage}:0:${job.fence}`);
      return true;
    } catch (error) {
      if (attemptPath) await family.assets.deletePrefix(attemptPath);
      const code = error instanceof DomainError ? error.code : 'generation_failed';
      const outcome = await family.repo.atomic(async (tx) => {
        const path = familyPath(uid, 'generation_jobs', id);
        const current = await tx.get<Job>(path);
        if (!current || current.fence !== job.fence) return;
        const qualityFailure = ['lesson_quality_failed', 'answer_key_invalid'].includes(code);
        const repair = qualityFailure && (current.repair_count ?? 0) < 2;
        const permanent =
          code.startsWith('ocr_') ||
          (qualityFailure && !repair) ||
          [
            'budget_exceeded',
            'page_limit',
            'active_pdf_rejected',
            'upload_too_large',
            'unsupported_source_language',
            'invalid_job_references',
          ].includes(code);
        const retryStage = repair ? 'generate' : current.stage;
        const retryAttempt = repair ? 0 : current.attempt;
        const retryable = !permanent && current.attempt < 3;
        tx.put(path, {
          ...current,
          stage: retryStage,
          attempt: retryAttempt,
          repair_count: repair ? (current.repair_count ?? 0) + 1 : (current.repair_count ?? 0),
          status: permanent || current.attempt >= 3 ? 'failed' : 'queued',
          error_code: code,
          lease_until: 0,
          next_attempt_at: this.now() + 1000 * 2 ** current.attempt,
          outbox_pending: retryable,
        });
        return { retryable, retryStage, retryAttempt, fence: current.fence };
      });
      if (outcome?.retryable)
        this.dispatch(uid, job, `${outcome.retryStage}:${outcome.retryAttempt}:${outcome.fence}`);
      return false;
    }
  }
}

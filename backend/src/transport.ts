import { familyPath, type Job, type Parent } from './domain';
import type { Repository } from './persistence';

// Dispatch identity for idempotent Cloud Tasks naming: one distinct token per unit of
// work (stage:attempt:fence), so repeated enqueues of the same work dedupe while
// retries and lease recoveries dispatch afresh.
export interface TaskPublisher {
  enqueue(uid: string, jobId: string, token: string): Promise<void>;
}
export const noopPublisher: TaskPublisher = {
  async enqueue() {},
};
type TaskClient = {
  createTask(request: { parent: string; task: Record<string, unknown> }): Promise<unknown>;
};
export class CloudTasksPublisher implements TaskPublisher {
  constructor(
    private client: TaskClient,
    private queuePath: string,
    private workerUrl: string,
    private serviceAccount: string,
  ) {}
  async enqueue(uid: string, jobId: string, token: string): Promise<void> {
    const name = `${this.queuePath}/tasks/${uid}-${jobId}-${token.replace(/[^A-Za-z0-9_-]/g, '_')}`
      .slice(0, 500)
      .replace(/[^\w-]+$/, '');
    await this.client.createTask({
      parent: this.queuePath,
      task: {
        name,
        httpRequest: {
          url: `${this.workerUrl}/v1/internal/jobs/${uid}/${jobId}`,
          httpMethod: 'POST',
          oidcToken: { serviceAccountEmail: this.serviceAccount, audience: this.workerUrl },
        },
      },
    });
  }
}
// Recovery path for lost dispatch: re-enqueues jobs whose outbox flag survived without
// a task, whose worker lease expired mid-stage, or whose retry backoff came due.
export class OutboxSweeper {
  constructor(
    private repo: Repository,
    private publisher: TaskPublisher,
    private now: () => number = Date.now,
  ) {}
  async sweep(): Promise<number> {
    let dispatched = 0;
    for (const parent of await this.repo.list<Parent>('parents')) {
      if (parent.state !== 'active') continue;
      for (const job of await this.repo.list<Job>(familyPath(parent.id, 'generation_jobs'))) {
        const stalled = job.status === 'running' && job.lease_until < this.now();
        const dueRetry = job.status === 'queued' && job.next_attempt_at <= this.now();
        if (!job.outbox_pending && !stalled && !dueRetry) continue;
        const base = `${job.stage}:${job.attempt}:${job.fence}`;
        await this.publisher.enqueue(parent.id, job.id, job.outbox_pending ? base : `${base}:r`);
        dispatched++;
      }
    }
    return dispatched;
  }
}

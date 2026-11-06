// Dispatch identity for idempotent enqueue naming: one distinct token per unit of
// work (stage:attempt:fence), so repeated enqueues of the same work dedupe while
// retries and lease recoveries dispatch afresh.
export interface TaskPublisher {
  enqueue(uid: string, jobId: string, token: string): Promise<void>;
}
export const noopPublisher: TaskPublisher = {
  async enqueue() {},
};

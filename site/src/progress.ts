// Durable progress queue and offline lesson cache for the web host.
// localStorage survives reloads; the queue flushes when the API is reachable.
import type { LessonEvent } from '@lessonbooks/contracts';
const QUEUE_KEY = 'lessonbooks-event-queue';
const LESSON_CACHE_PREFIX = 'lessonbooks-lesson-';
const KID_CACHE_KEY = 'lessonbooks-kid-cache';
const QUEUE_LIMIT = 500;
export type CachedSummary = {
  id: string;
  kid_id: string;
  summary: string;
  status: 'draft' | 'approved';
  revision: number;
};
export function loadQueue(): LessonEvent[] {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as LessonEvent[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function saveQueue(events: LessonEvent[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-QUEUE_LIMIT)));
  } catch {
    /* storage full or unavailable: keep playing, next enqueue retries */
  }
}
export function enqueueEvent(event: LessonEvent) {
  saveQueue([...loadQueue(), event]);
}
export async function flushQueue(
  post: (events: LessonEvent[]) => Promise<{ accepted: number }>,
): Promise<number> {
  const queue = loadQueue();
  if (!queue.length) return 0;
  const batch = queue.slice(0, 50);
  await post(batch);
  saveQueue(queue.slice(batch.length));
  return batch.length;
}
export function cacheLesson(id: string, revision: number, lesson: unknown) {
  try {
    localStorage.setItem(`${LESSON_CACHE_PREFIX}${id}-${revision}`, JSON.stringify(lesson));
  } catch {
    /* cache is best-effort */
  }
}
export function loadCachedLesson(id: string, revision: number): unknown | undefined {
  try {
    const raw = localStorage.getItem(`${LESSON_CACHE_PREFIX}${id}-${revision}`);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}
export function cacheKidLessons(summaries: CachedSummary[]) {
  try {
    localStorage.setItem(
      KID_CACHE_KEY,
      JSON.stringify(summaries.filter((s) => s.status === 'approved')),
    );
  } catch {
    /* cache is best-effort */
  }
}
export function loadCachedKidLessons(): CachedSummary[] {
  try {
    const value = JSON.parse(localStorage.getItem(KID_CACHE_KEY) ?? '[]') as CachedSummary[];
    return Array.isArray(value) ? value.filter((item) => item && item.id && item.kid_id) : [];
  } catch {
    return [];
  }
}

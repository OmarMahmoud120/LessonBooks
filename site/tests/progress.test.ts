import { beforeEach, describe, expect, it } from 'vitest';
import type { LessonEvent } from '@lessonbooks/contracts';
import {
  cacheKidLessons,
  cacheLesson,
  enqueueEvent,
  flushQueue,
  loadCachedKidLessons,
  loadCachedLesson,
  loadQueue,
  type CachedSummary,
} from '../src/progress';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
}

function event(id: string): LessonEvent {
  return {
    event_id: id,
    schema_version: '1.0.0',
    lesson_id: 'lesson-1',
    lesson_revision: 1,
    type: 'started',
    timestamp: '2026-11-05T10:00:00.000Z',
  };
}

function summary(overrides: Partial<CachedSummary> = {}): CachedSummary {
  return {
    id: 'lesson-1',
    kid_id: 'kid-1',
    summary: 'Counting',
    status: 'approved',
    revision: 1,
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage() as unknown as Storage;
});

describe('progress queue', () => {
  it('persists events across reads and keeps arrival order', () => {
    enqueueEvent(event('a'));
    enqueueEvent(event('b'));
    expect(loadQueue().map((item) => item.event_id)).toEqual(['a', 'b']);
  });

  it('bounds the queue so local storage cannot grow without limit', () => {
    for (let i = 0; i < 520; i++) enqueueEvent(event(`evt-${i}`));
    const queue = loadQueue();
    expect(queue).toHaveLength(500);
    expect(queue[0]?.event_id).toBe('evt-20');
    expect(queue.at(-1)?.event_id).toBe('evt-519');
  });

  it('flushes at most fifty events and keeps the rest queued', async () => {
    for (let i = 0; i < 60; i++) enqueueEvent(event(`evt-${i}`));
    const batches: LessonEvent[][] = [];
    const flushed = await flushQueue(async (batch) => {
      batches.push(batch);
      return { accepted: batch.length };
    });
    expect(flushed).toBe(50);
    expect(batches[0]).toHaveLength(50);
    expect(loadQueue()).toHaveLength(10);
    expect(loadQueue()[0]?.event_id).toBe('evt-50');
  });

  it('keeps queued events when the batch post fails', async () => {
    enqueueEvent(event('a'));
    await expect(flushQueue(async () => Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    );
    expect(loadQueue().map((item) => item.event_id)).toEqual(['a']);
  });

  it('does not call the API when the queue is empty', async () => {
    let calls = 0;
    const flushed = await flushQueue(async () => {
      calls++;
      return { accepted: 0 };
    });
    expect(flushed).toBe(0);
    expect(calls).toBe(0);
  });

  it('recovers from corrupt queue storage instead of failing play', () => {
    localStorage.setItem('lessonbooks-event-queue', '{not json');
    expect(loadQueue()).toEqual([]);
  });
});

describe('offline lesson cache', () => {
  it('round-trips an approved lesson by id and revision', () => {
    cacheLesson('lesson-1', 2, { title: 'Counting' });
    expect(loadCachedLesson('lesson-1', 2)).toEqual({ title: 'Counting' });
    expect(loadCachedLesson('lesson-1', 1)).toBeUndefined();
  });

  it('treats corrupt cached lessons as missing', () => {
    localStorage.setItem('lessonbooks-lesson-lesson-1-1', '{not json');
    expect(loadCachedLesson('lesson-1', 1)).toBeUndefined();
  });

  it('caches only approved kid summaries and drops malformed entries', () => {
    cacheKidLessons([summary(), summary({ id: 'draft', status: 'draft' })]);
    expect(loadCachedKidLessons()).toEqual([summary()]);
    localStorage.setItem(
      'lessonbooks-kid-cache',
      JSON.stringify([{ id: 'missing-fields' }, summary({ id: 'valid' })]),
    );
    expect(loadCachedKidLessons().map((item) => item.id)).toEqual(['valid']);
  });

  it('ignores unavailable storage so play can continue', () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
      clear() {
        throw new Error('denied');
      },
      key() {
        throw new Error('denied');
      },
      length: 0,
    } as unknown as Storage;
    expect(() => enqueueEvent(event('a'))).not.toThrow();
    expect(loadQueue()).toEqual([]);
    expect(() => cacheLesson('lesson-1', 1, {})).not.toThrow();
    expect(loadCachedLesson('lesson-1', 1)).toBeUndefined();
  });
});

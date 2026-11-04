import { describe, expect, it, vi } from 'vitest';
import { createUploadCopies } from '../src/uploadCopies';

function setup() {
  const root = 'file:///private/app/cache/';
  const stored = new Set([
    root + 'DocumentPicker/book.pdf',
    root + 'unrelated',
    'content://original',
  ]);
  const files = {
    cacheDirectory: root,
    deleteAsync: vi.fn(async (uri: string) => {
      for (const entry of stored) if (entry.startsWith(uri + '/')) stored.delete(entry);
    }),
  };
  return { root, stored, files, copies: createUploadCopies(files) };
}

describe('private upload copies', () => {
  it('clears pre-callback crash residue and preserves sources and unrelated cache', async () => {
    const s = setup();
    await s.copies.cleanup();
    await s.copies.cleanup();
    expect([...s.stored]).toEqual([s.root + 'unrelated', 'content://original']);
    expect(s.files.deleteAsync).toHaveBeenCalledWith(s.root + 'DocumentPicker', {
      idempotent: true,
    });
  });

  it.each(['success', 'upload failure', 'form-data failure', 'picker failure', 'cancel'])(
    'cleans partial copies after %s',
    async (outcome) => {
      const s = setup();
      const result = s.copies.run(async () => {
        expect(s.stored.has(s.root + 'DocumentPicker/book.pdf')).toBe(false);
        s.stored.add(s.root + 'DocumentPicker/partial.pdf');
        if (outcome.endsWith('failure')) throw new Error(outcome);
        return outcome;
      });
      if (outcome.endsWith('failure')) await expect(result).rejects.toThrow(outcome);
      else expect(await result).toBe(outcome);
      expect(s.stored.has(s.root + 'DocumentPicker/partial.pdf')).toBe(false);
    },
  );

  it('serializes cleanup and selection behind an active upload', async () => {
    const s = setup();
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const upload = s.copies.run(async () => {
      s.stored.add(s.root + 'DocumentPicker/active.pdf');
      entered();
      await hold;
    });
    await started;
    const cleanup = s.copies.cleanup();
    const pick = vi.fn(async () => {});
    const next = s.copies.run(pick);
    await Promise.resolve();
    expect(s.stored.has(s.root + 'DocumentPicker/active.pdf')).toBe(true);
    expect(pick).not.toHaveBeenCalled();
    finish();
    await Promise.all([upload, cleanup, next]);
    expect(pick).toHaveBeenCalledOnce();
    expect(s.stored.has(s.root + 'DocumentPicker/active.pdf')).toBe(false);
  });

  it('removes an interrupted session copy when a fresh process starts', async () => {
    const s = setup();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    void s.copies.run(async () => {
      s.stored.add(s.root + 'DocumentPicker/abandoned.pdf');
      entered();
      return new Promise(() => {}); // A killed process cannot execute finally.
    });
    await started;
    await createUploadCopies(s.files).cleanup();
    expect(s.stored.has(s.root + 'DocumentPicker/abandoned.pdf')).toBe(false);
  });

  it('blocks selection when initial cleanup fails, then permits retry', async () => {
    const s = setup();
    s.files.deleteAsync.mockRejectedValueOnce(new Error('disk error'));
    const pick = vi.fn(async () => {});
    await expect(s.copies.run(pick)).rejects.toThrow('disk error');
    expect(pick).not.toHaveBeenCalled();
    await s.copies.run(pick);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('surfaces final cleanup failure and retries on next startup', async () => {
    const s = setup();
    await expect(
      s.copies.run(async () => {
        s.stored.add(s.root + 'DocumentPicker/retry.pdf');
        s.files.deleteAsync.mockRejectedValueOnce(new Error('disk error'));
      }),
    ).rejects.toThrow('disk error');
    await createUploadCopies(s.files).cleanup();
    expect(s.stored.has(s.root + 'DocumentPicker/retry.pdf')).toBe(false);
  });

  it('refuses unavailable or non-file cache roots without deletion', async () => {
    for (const cacheDirectory of [null, 'content://provider/', 'file:///cache']) {
      const files = { cacheDirectory, deleteAsync: vi.fn() };
      await expect(createUploadCopies(files).cleanup()).rejects.toThrow('upload_cache_unavailable');
      expect(files.deleteAsync).not.toHaveBeenCalled();
    }
  });
});

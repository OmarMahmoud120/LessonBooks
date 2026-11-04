export interface UploadFileSystem {
  cacheDirectory: string | null;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}

// Expo SDK 54 copies selections into this app-private directory on Android and iOS.
// This directory is reserved for one-shot book uploads; never store other assets here.
export function createUploadCopies(files: UploadFileSystem) {
  let pending: Promise<unknown> = Promise.resolve();
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  }
  async function clear() {
    if (!files.cacheDirectory?.startsWith('file:///') || !files.cacheDirectory.endsWith('/'))
      throw new Error('upload_cache_unavailable');
    // Delete only the SDK-owned picker directory, including copies left before JS received a result.
    await files.deleteAsync(`${files.cacheDirectory}DocumentPicker`, { idempotent: true });
  }
  return {
    cleanup: () => exclusive(clear),
    run: <T>(action: () => Promise<T>) =>
      exclusive(async () => {
        // Fail closed before opening another picker if old private copies cannot be removed.
        await clear();
        try {
          return await action();
        } finally {
          await clear();
        }
      }),
  };
}

export interface Transaction {
  get<T>(path: string): Promise<T | undefined>;
  list<T>(path: string): Promise<T[]>;
  put<T extends object>(path: string, value: T): void;
  delete(path: string): void;
}
export interface Repository {
  get<T>(path: string): Promise<T | undefined>;
  list<T>(collection: string): Promise<T[]>;
  atomic<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  deleteTree(path: string): Promise<void>;
}
export interface Assets {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  deletePrefix(prefix: string): Promise<void>;
}
export class MemoryRepository implements Repository {
  readonly documents = new Map<string, object>();
  private pending = Promise.resolve();
  async get<T>(path: string): Promise<T | undefined> {
    return structuredClone(this.documents.get(path)) as T | undefined;
  }
  async list<T>(collection: string): Promise<T[]> {
    return [...this.documents.entries()]
      .filter(
        ([p]) =>
          p.startsWith(collection + '/') &&
          p.split('/').length === collection.split('/').length + 1,
      )
      .map(([, v]) => structuredClone(v) as T);
  }
  async atomic<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const previous = this.pending;
    let unlock!: () => void;
    this.pending = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    const changes = new Map<string, object | null>();
    try {
      const result = await fn({
        get: <V>(p: string) => this.get<V>(p),
        list: async <V>(p: string) => this.list<V>(p),
        put: (p, v) => {
          changes.set(p, structuredClone(v));
        },
        delete: (p) => {
          changes.set(p, null);
        },
      });
      for (const [path, value] of changes) {
        if (value === null) this.documents.delete(path);
        else this.documents.set(path, value);
      }
      return result;
    } finally {
      unlock();
    }
  }
  async deleteTree(path: string) {
    for (const key of this.documents.keys())
      if (key === path || key.startsWith(path + '/')) this.documents.delete(key);
  }
}
export class MemoryAssets implements Assets {
  readonly objects = new Map<string, Uint8Array>();
  async put(path: string, bytes: Uint8Array) {
    this.objects.set(path, new Uint8Array(bytes));
  }
  async get(path: string) {
    const value = this.objects.get(path);
    if (!value) throw new Error('asset_not_found');
    return new Uint8Array(value);
  }
  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) this.objects.delete(key);
  }
}

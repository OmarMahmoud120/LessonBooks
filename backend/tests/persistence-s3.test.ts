import { describe, expect, it } from 'vitest';
import { AwsS3Transport, S3Assets, type S3Transport } from '../src/persistence-s3';

type Stored = { bytes: Uint8Array; contentType: string; cacheControl: string };

class MemoryTransport implements S3Transport {
  readonly objects = new Map<string, Stored>();
  readonly batches: number[] = [];
  readonly buckets = new Set<string>();
  readonly created: string[] = [];
  constructor(seed: string[] = []) {
    for (const key of seed)
      this.objects.set(key, {
        bytes: new Uint8Array([1]),
        contentType: 'application/octet-stream',
        cacheControl: 'private, no-store',
      });
  }
  async ensureBucket(input: { bucket: string }) {
    if (this.buckets.has(input.bucket)) return;
    this.buckets.add(input.bucket);
    this.created.push(input.bucket);
  }
  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl: string;
  }) {
    this.objects.set(input.key, {
      bytes: new Uint8Array(input.body),
      contentType: input.contentType,
      cacheControl: input.cacheControl,
    });
  }
  async get(input: { bucket: string; key: string }) {
    const value = this.objects.get(input.key);
    if (!value) {
      const error = new Error('missing');
      error.name = 'NoSuchKey';
      throw error;
    }
    return new Uint8Array(value.bytes);
  }
  async list(input: { bucket: string; prefix: string }) {
    return [...this.objects.keys()].filter((key) => key.startsWith(input.prefix)).slice(0, 1000);
  }
  async delete(input: { bucket: string; keys: string[] }) {
    this.batches.push(input.keys.length);
    for (const key of input.keys) this.objects.delete(key);
  }
}

describe('S3Assets', () => {
  it('creates the configured bucket before first use', async () => {
    const transport = new MemoryTransport();
    const assets = new S3Assets(transport, 'lessonbooks');
    await assets.init();
    await assets.init();
    expect(transport.created).toEqual(['lessonbooks']);
  });

  it('rejects an invalid bucket name before any request', () => {
    expect(() => new S3Assets(new MemoryTransport(), 'Bad_Bucket')).toThrow('invalid_bucket_name');
    expect(() => new S3Assets(new MemoryTransport(), 'ab')).toThrow('invalid_bucket_name');
  });

  it('stores private bytes with content type and no-store cache control', async () => {
    const transport = new MemoryTransport();
    const assets = new S3Assets(transport, 'lessonbooks');
    await assets.put(
      'families/alice/books/one/source.pdf',
      new Uint8Array([1, 2, 3]),
      'application/pdf',
    );
    expect(transport.objects.get('families/alice/books/one/source.pdf')).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
      cacheControl: 'private, no-store',
    });
    expect(await assets.get('families/alice/books/one/source.pdf')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('maps a missing object to a fixed asset_not_found error', async () => {
    const assets = new S3Assets(new MemoryTransport(), 'lessonbooks');
    await expect(assets.get('families/alice/missing.pdf')).rejects.toThrow('asset_not_found');
  });

  it('deletes a directory prefix without touching sibling families or books', async () => {
    const transport = new MemoryTransport([
      'families/alice/books/one/source.pdf',
      'families/alice/books/one/pages/page-1.png',
      'families/alice/books/two/source.pdf',
      'families/bob/books/one/source.pdf',
    ]);
    const assets = new S3Assets(transport, 'lessonbooks');
    await assets.deletePrefix('families/alice/books/one/');
    expect([...transport.objects.keys()].sort()).toEqual([
      'families/alice/books/two/source.pdf',
      'families/bob/books/one/source.pdf',
    ]);
  });

  it('deletes an exact object path used for replaced uploads', async () => {
    const transport = new MemoryTransport([
      'families/alice/books/one/source.pdf',
      'families/alice/books/one/pages/page-1.png',
    ]);
    const assets = new S3Assets(transport, 'lessonbooks');
    await assets.deletePrefix('families/alice/books/one/source.pdf');
    expect([...transport.objects.keys()]).toEqual(['families/alice/books/one/pages/page-1.png']);
  });

  it('deletes more than one S3 batch and keeps listing until the prefix is empty', async () => {
    const keys = Array.from(
      { length: 1001 },
      (_, index) => `families/alice/jobs/job/${index}.json`,
    );
    const transport = new MemoryTransport(keys);
    const assets = new S3Assets(transport, 'lessonbooks');
    await assets.deletePrefix('families/alice/jobs/job/');
    expect(transport.batches).toEqual([1000, 1]);
    expect(transport.objects.size).toBe(0);
  });

  it('rejects empty, absolute or parent-traversing keys before transport', async () => {
    const transport = new MemoryTransport();
    const assets = new S3Assets(transport, 'lessonbooks');
    await expect(assets.put('', new Uint8Array(), 'text/plain')).rejects.toThrow(
      'invalid_asset_path',
    );
    await expect(assets.put('/rooted', new Uint8Array(), 'text/plain')).rejects.toThrow(
      'invalid_asset_path',
    );
    await expect(assets.deletePrefix('families/../bob')).rejects.toThrow('invalid_asset_path');
    expect(transport.objects.size).toBe(0);
  });
});

describe('AwsS3Transport bucket bootstrap', () => {
  function fakeClient(handler: (name: string) => void) {
    return {
      async send(command: { constructor: { name: string } }) {
        handler(command.constructor.name);
        return {};
      },
    };
  }

  it('creates the bucket only when HeadBucket reports 404', async () => {
    const sent: string[] = [];
    const client = fakeClient((name) => {
      sent.push(name);
      if (name === 'HeadBucketCommand')
        throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
    });
    await new AwsS3Transport(client as never).ensureBucket({ bucket: 'lessonbooks' });
    expect(sent).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);
  });

  it('leaves an existing bucket untouched', async () => {
    const sent: string[] = [];
    await new AwsS3Transport(fakeClient((name) => sent.push(name)) as never).ensureBucket({
      bucket: 'lessonbooks',
    });
    expect(sent).toEqual(['HeadBucketCommand']);
  });

  it('does not create a bucket when HeadBucket fails for another reason', async () => {
    const sent: string[] = [];
    const client = fakeClient((name) => {
      sent.push(name);
      throw Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 403 } });
    });
    await expect(
      new AwsS3Transport(client as never).ensureBucket({ bucket: 'lessonbooks' }),
    ).rejects.toThrow('denied');
    expect(sent).toEqual(['HeadBucketCommand']);
  });
});

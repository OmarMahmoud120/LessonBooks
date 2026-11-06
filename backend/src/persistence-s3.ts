import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Assets } from './persistence';

// Narrow transport so prefix pagination, batch deletion, bucket creation and error
// mapping can be tested without an S3/MinIO server. The AWS adapter below is the
// production binding.
export interface S3Transport {
  ensureBucket(input: { bucket: string }): Promise<void>;
  put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl: string;
  }): Promise<void>;
  get(input: { bucket: string; key: string }): Promise<Uint8Array>;
  list(input: { bucket: string; prefix: string }): Promise<string[]>;
  delete(input: { bucket: string; keys: string[] }): Promise<void>;
}

const DELETE_BATCH = 1000;
const NOT_FOUND = new Set(['NoSuchKey', 'NotFound', 'NoSuchBucket']);
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function assertPath(path: string) {
  if (!path || path.startsWith('/') || path.includes('..')) throw new Error('invalid_asset_path');
}

export class S3Assets implements Assets {
  constructor(
    private transport: S3Transport,
    private bucket: string,
  ) {
    if (!BUCKET_NAME.test(bucket)) throw new Error('invalid_bucket_name');
  }

  async init() {
    await this.transport.ensureBucket({ bucket: this.bucket });
  }

  async put(path: string, bytes: Uint8Array, contentType: string) {
    assertPath(path);
    await this.transport.put({
      bucket: this.bucket,
      key: path,
      body: bytes,
      contentType,
      cacheControl: 'private, no-store',
    });
  }

  async get(path: string) {
    assertPath(path);
    try {
      return await this.transport.get({ bucket: this.bucket, key: path });
    } catch (error) {
      if (error instanceof Error && NOT_FOUND.has(error.name)) throw new Error('asset_not_found');
      throw error;
    }
  }

  async deletePrefix(prefix: string) {
    assertPath(prefix);
    // Deleting while listing is supported here by restarting the listing after each
    // batch; the loop converges because every listed key is removed.
    for (;;) {
      const keys = await this.transport.list({ bucket: this.bucket, prefix });
      if (!keys.length) return;
      for (let start = 0; start < keys.length; start += DELETE_BATCH) {
        await this.transport.delete({
          bucket: this.bucket,
          keys: keys.slice(start, start + DELETE_BATCH),
        });
      }
    }
  }
}

export class AwsS3Transport implements S3Transport {
  constructor(private client: S3Client) {}

  async ensureBucket(input: { bucket: string }) {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: input.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status !== 404 && name !== 'NotFound' && name !== 'NoSuchBucket') throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: input.bucket }));
    }
  }

  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl: string;
  }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
      }),
    );
  }

  async get(input: { bucket: string; key: string }) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
    if (!response.Body) throw new Error('asset_not_found');
    return response.Body.transformToByteArray();
  }

  async list(input: { bucket: string; prefix: string }) {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.prefix,
        MaxKeys: DELETE_BATCH,
      }),
    );
    return (response.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []));
  }

  async delete(input: { bucket: string; keys: string[] }) {
    if (!input.keys.length) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: input.bucket,
        Delete: { Objects: input.keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

export type S3Settings = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
};

export function createS3Transport(settings: S3Settings) {
  return new AwsS3Transport(
    new S3Client({
      endpoint: settings.endpoint,
      region: settings.region ?? 'us-east-1',
      forcePathStyle: true,
      // Garage and other non-AWS S3 servers reject some default flexible checksums.
      // Only send them when the operation requires one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    }),
  );
}

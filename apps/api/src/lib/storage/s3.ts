import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Storage } from './types';

export interface S3StorageOptions {
  /** API-side endpoint (e.g. `http://localhost:9000` or the docker network name). */
  endpoint?: string;
  /** Endpoint browsers reach; used only to sign GET URLs. Defaults to `endpoint`. */
  publicUrl?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Signature of the presigner, injectable in tests. */
export type Presign = (client: S3Client, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

/**
 * S3 driver (MinIO locally, path-style addressing). The bucket stays private: browsers read photos only
 * through presigned GET URLs, signed against `publicUrl` so the host in the URL is one they can reach.
 */
export class S3Storage implements Storage {
  readonly driver = 's3' as const;
  readonly bucket: string;
  private readonly signer: S3Client;

  constructor(
    options: S3StorageOptions,
    readonly client: S3Client = S3Storage.client(options, options.endpoint),
    private readonly presign: Presign = getSignedUrl as Presign,
  ) {
    this.bucket = options.bucket;
    // Presigning is local (no request), so a second client pointed at the public URL costs nothing.
    this.signer = S3Storage.client(options, options.publicUrl ?? options.endpoint);
  }

  static client(options: S3StorageOptions, endpoint: string | undefined): S3Client {
    return new S3Client({
      endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  signedGetUrl(key: string, ttlSec: number): Promise<string> {
    return this.presign(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSec });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Creates the bucket when it is missing. No bucket policy is set, so it stays private. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.name === 'NoSuchBucket' || e?.$metadata?.httpStatusCode === 404;
}

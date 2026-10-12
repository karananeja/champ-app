import { env, type Env } from '../../config/env';
import { MemoryStorage } from './memory';
import { S3Storage } from './s3';
import type { Storage } from './types';

export { MemoryStorage } from './memory';
export { S3Storage } from './s3';
export { PHOTO_URL_TTL_SEC, type Storage } from './types';

type StorageEnv = Pick<
  Env,
  'STORAGE_DRIVER' | 'S3_ENDPOINT' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'S3_BUCKET' | 'S3_REGION' | 'S3_PUBLIC_URL'
>;

/** The storage driver chosen by `STORAGE_DRIVER` (default `s3`; tests use `memory`). */
export function createStorage(e: StorageEnv = env): Storage {
  if (e.STORAGE_DRIVER === 'memory') return new MemoryStorage();
  if (!e.S3_ACCESS_KEY || !e.S3_SECRET_KEY) {
    throw new Error('STORAGE_DRIVER=s3 needs S3_ACCESS_KEY and S3_SECRET_KEY (see .env.example)');
  }
  return new S3Storage({
    endpoint: e.S3_ENDPOINT,
    publicUrl: e.S3_PUBLIC_URL,
    region: e.S3_REGION,
    bucket: e.S3_BUCKET,
    accessKeyId: e.S3_ACCESS_KEY,
    secretAccessKey: e.S3_SECRET_KEY,
  });
}

let shared: Storage | undefined;

/**
 * One storage per process, so every `createApp()` (tests build one per request) sees the same objects.
 */
export function defaultStorage(): Storage {
  shared ??= createStorage();
  return shared;
}

/** Object storage for photos (F06, D-102): an S3 driver (MinIO locally, S3 in production) and an in-memory one for tests. */
export interface Storage {
  readonly driver: 's3' | 'memory';
  /** Stores an object (private). */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** A short-lived GET URL a browser can open. */
  signedGetUrl(key: string, ttlSec: number): Promise<string>;
  exists?(key: string): Promise<boolean>;
  /** Removes an object; used only for best-effort cleanup when the database write after an upload fails. */
  delete(key: string): Promise<void>;
  /** Creates the bucket if it is missing (s3 driver, at API start). */
  ensureBucket?(): Promise<void>;
}

/** Presigned GET URLs live 10 minutes (the web refetches the photo list every ~8 minutes). */
export const PHOTO_URL_TTL_SEC = 600;

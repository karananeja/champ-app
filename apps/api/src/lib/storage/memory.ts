import type { Storage } from './types';

/** In-memory storage for tests: objects live in a Map; signed URLs are fake but carry the key and TTL. */
export class MemoryStorage implements Storage {
  readonly driver = 'memory' as const;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async signedGetUrl(key: string, ttlSec: number): Promise<string> {
    return `http://storage.test/${key}?expires=${ttlSec}`;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

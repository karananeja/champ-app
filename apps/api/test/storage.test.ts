import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { MemoryStorage, S3Storage, createStorage } from '../src/lib/storage';

const OPTIONS = {
  endpoint: 'http://minio:9000',
  publicUrl: 'http://photos.example.test:9000',
  region: 'us-east-1',
  bucket: 'champ-photos',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
};

/** A fake S3 client recording the commands it was sent. */
function fakeClient(handler: (command: unknown) => unknown = () => ({})) {
  const send = vi.fn(async (command: unknown) => handler(command));
  return { client: { send } as unknown as S3Client, send };
}

describe('S3Storage (D-102)', () => {
  it('puts objects under the key with the content type', async () => {
    const { client, send } = fakeClient();
    const storage = new S3Storage(OPTIONS, client);
    await storage.put('fitments/f1/p1.jpg', Buffer.from('jpeg'), 'image/jpeg');
    const command = send.mock.calls[0]![0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'champ-photos', Key: 'fitments/f1/p1.jpg', ContentType: 'image/jpeg' });
  });

  it('signs GET URLs against S3_PUBLIC_URL (path style) with the TTL, without calling S3', async () => {
    const { client, send } = fakeClient();
    const storage = new S3Storage(OPTIONS, client);
    const url = new URL(await storage.signedGetUrl('fitments/f1/p1.jpg', 600));
    expect(url.origin).toBe('http://photos.example.test:9000');
    expect(url.pathname).toBe('/champ-photos/fitments/f1/p1.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(send).not.toHaveBeenCalled();
  });

  it('ensureBucket creates a missing bucket (and sets no public policy); an existing one is left alone', async () => {
    const missing = fakeClient((command) => {
      if (command instanceof HeadBucketCommand) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return {};
    });
    await new S3Storage(OPTIONS, missing.client).ensureBucket();
    expect(missing.send.mock.calls.map(([c]) => (c as object).constructor)).toEqual([HeadBucketCommand, CreateBucketCommand]);

    const existing = fakeClient();
    await new S3Storage(OPTIONS, existing.client).ensureBucket();
    expect(existing.send).toHaveBeenCalledTimes(1);

    const down = fakeClient(() => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'Error' });
    });
    await expect(new S3Storage(OPTIONS, down.client).ensureBucket()).rejects.toThrow('ECONNREFUSED');
  });

  it('exists() maps 404 to false', async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
    });
    expect(await new S3Storage(OPTIONS, client).exists('nope')).toBe(false);
  });

  it('the driver comes from STORAGE_DRIVER; s3 needs credentials', () => {
    const base = { S3_ENDPOINT: undefined, S3_ACCESS_KEY: undefined, S3_SECRET_KEY: undefined, S3_BUCKET: 'champ', S3_REGION: 'us-east-1', S3_PUBLIC_URL: 'http://localhost:9000' };
    expect(createStorage({ ...base, STORAGE_DRIVER: 'memory' })).toBeInstanceOf(MemoryStorage);
    expect(() => createStorage({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_ACCESS_KEY/);
    const s3 = createStorage({ ...base, STORAGE_DRIVER: 's3', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' });
    expect(s3).toBeInstanceOf(S3Storage);
    expect((s3 as S3Storage).bucket).toBe('champ');
  });
});

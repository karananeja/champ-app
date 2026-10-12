import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

/** Tests run against a separate database (default: <DATABASE_URL db>_test), reset per run. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://champ:champ@localhost:5432/champ');
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

const TEST_DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: 'test-secret-not-for-production',
      WEB_URL: 'http://localhost:5173',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_ALLOWED_DOMAIN: 'intellicar.in',
      // Safety net: nothing listens here, so a test that forgot to inject a fake geocoder gets a 503 and never
      // reaches the real Nominatim.
      NOMINATIM_URL: 'http://127.0.0.1:9',
    },
  },
});

import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Pick up DATABASE_URL etc. from the repo-root .env when present.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // No .env: fall back to the docker-compose defaults below.
}

const API_PORT = 4100;
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}`;

/** E2E runs against its own database (<db>_e2e), recreated and seeded on every run. */
function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://champ:champ@localhost:5432/champ');
  url.pathname = `${url.pathname}_e2e`;
  return url.toString();
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Creates the org used by the F02 specs (see e2e/org.setup.ts).
    { name: 'setup', testMatch: /org\.setup\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @champ/api e2e:serve',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: e2eDatabaseUrl(),
        API_PORT: String(API_PORT),
        WEB_URL,
        GOOGLE_CLIENT_ID: '',
        // Geocoding is stubbed in the browser (page.route); this unreachable URL guarantees the API itself
        // never calls the real Nominatim during E2E.
        NOMINATIM_URL: 'http://127.0.0.1:9',
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'e2e-secret-not-for-production',
        // F05: the dev technician simulator (D-073) drives the OT steps in the workflow spec.
        ENABLE_DEV_SIMULATOR: 'true',
        // F06: photos go to the real MinIO (docker compose) in a bucket of their own, created at API start.
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'champ-e2e',
        S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://localhost:9000',
        S3_PUBLIC_URL: process.env.S3_PUBLIC_URL || 'http://localhost:9000',
        S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || 'champ',
        S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'champchamp',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PORT: String(API_PORT) },
    },
  ],
});

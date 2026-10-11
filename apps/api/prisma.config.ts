import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The .env file lives at the repository root.
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Fallback lets `prisma generate` run (e.g. on install) before .env exists.
    url: process.env.DATABASE_URL ?? 'postgresql://champ:champ@localhost:5432/champ',
  },
});

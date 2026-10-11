import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load the repository-root .env. Variables already set in the process win.
loadEnv({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(8, 'JWT_ACCESS_SECRET must be at least 8 characters'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.url().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  GOOGLE_ALLOWED_DOMAIN: z.string().min(1).default('intellicar.in'),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),
  // Geocoding (F03, D-054)
  NOMINATIM_URL: z.preprocess(emptyToUndefined, z.url().default('https://nominatim.openstreetmap.org')),
  GEOCODER_CONTACT_EMAIL: z.preprocess(emptyToUndefined, z.email().default('admin@intellicar.in')),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = z.prettifyError(result.error);
    throw new Error(`Invalid environment configuration:\n${details}\nSee .env.example.`);
  }
  return result.data;
}

export const env = parseEnv();

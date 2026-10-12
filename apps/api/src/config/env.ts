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
  WEB_URL: z.url().default('http://localhost:3000'),
  GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  GOOGLE_ALLOWED_DOMAIN: z.string().min(1).default('intellicar.in'),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.string().optional()),
  // Photo storage (F06, D-102): `s3` (MinIO locally, S3 in production) or `memory` (tests).
  STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(['s3', 'memory']).default('s3')),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().default('champ')),
  S3_REGION: z.preprocess(emptyToUndefined, z.string().default('us-east-1')),
  // Endpoint used to sign GET URLs, so browsers can reach them (MinIO's published port locally).
  S3_PUBLIC_URL: z.preprocess(emptyToUndefined, z.url().default('http://localhost:9000')),
  // Geocoding (F03, D-054)
  NOMINATIM_URL: z.preprocess(emptyToUndefined, z.url().default('https://nominatim.openstreetmap.org')),
  GEOCODER_CONTACT_EMAIL: z.preprocess(emptyToUndefined, z.email().default('admin@intellicar.in')),
  // Route optimisation (F10, D-015): OSRM trip service. Tests and E2E point it at an unreachable port (fallback).
  OSRM_URL: z.preprocess(emptyToUndefined, z.url().default('https://router.project-osrm.org')),
  // Dev-only technician simulator (F05, D-073). Unset: on in development, off otherwise. Always off in production.
  ENABLE_DEV_SIMULATOR: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
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

/** Whether the dev simulator API is mounted (`ENABLE_DEV_SIMULATOR`, never when NODE_ENV=production). */
export function devSimulatorEnabled(e: Pick<Env, 'NODE_ENV' | 'ENABLE_DEV_SIMULATOR'> = env): boolean {
  if (e.NODE_ENV === 'production') return false;
  return (e.ENABLE_DEV_SIMULATOR ?? (e.NODE_ENV === 'development' ? 'true' : 'false')) === 'true';
}

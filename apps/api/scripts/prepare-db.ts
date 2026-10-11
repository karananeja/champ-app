/**
 * Recreates a throw-away database (used by the API tests and the E2E suite):
 * creates it if missing, drops all objects and applies the Prisma migrations.
 *
 * Refuses to touch a database whose name doesn't end in `_test` or `_e2e`.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

export async function prepareDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!/_(test|e2e)$/.test(dbName)) {
    throw new Error(`Refusing to reset "${dbName}": only *_test or *_e2e databases can be reset`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
  } finally {
    await admin.end();
  }

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await db.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
}

// CLI usage: `tsx scripts/prepare-db.ts` (uses DATABASE_URL).
if (import.meta.filename === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  await prepareDatabase(url);
  console.log(`Prepared ${new URL(url).pathname.slice(1)}`);
}

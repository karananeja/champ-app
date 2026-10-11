import type { TestProject } from 'vitest/node';
import { prepareDatabase } from '../scripts/prepare-db';

export default async function setup(project: TestProject) {
  const url = project.config.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing in vitest env');
  await prepareDatabase(url);
}

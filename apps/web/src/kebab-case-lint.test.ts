// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// CR-03 / D-084: the repo ESLint config enforces kebab-case file and folder names.
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(file: string): Promise<string[]> {
  const [result] = await eslint.lintText('export const value = 1;\n', { filePath: path.join(repoRoot, file) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? '');
}

describe('kebab-case file name lint rule', () => {
  it.each([
    'apps/web/src/components/BadName.tsx',
    'apps/web/src/features/tasks/taskThing.ts',
    'apps/api/src/lib/someHelper.ts',
    'packages/shared/src/MyModule.ts',
    'apps/web/e2e/MySpec.spec.ts',
  ])('rejects %s', async (file) => {
    expect(await ruleIds(file)).toContain('check-file/filename-naming-convention');
  });

  it('rejects a non-kebab folder', async () => {
    expect(await ruleIds('apps/web/src/BadFolder/ok-name.ts')).toContain('check-file/folder-naming-convention');
  });

  it.each([
    'apps/web/src/components/empty-state.tsx',
    'apps/web/src/features/tasks/task-table.test.tsx',
    'apps/web/e2e/org.setup.ts',
    'apps/web/e2e/cr-01.spec.ts',
    'apps/api/src/types.d.ts',
    'apps/api/vitest.config.ts',
  ])('accepts %s', async (file) => {
    const ids = await ruleIds(file);
    expect(ids.filter((id) => id.startsWith('check-file/'))).toEqual([]);
  });
});

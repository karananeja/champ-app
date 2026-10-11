// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { SIMULATOR_MARKERS, simulatorTraces } from '../scripts/check-prod-bundle';

const webRoot = path.resolve(import.meta.dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'champ-web-build-'));

afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe('production bundle (F05, D-073)', () => {
  it('contains no dev technician simulator', async () => {
    // Vitest runs with NODE_ENV=test, which would make Vite build with import.meta.env.DEV = true.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await build({
      root: webRoot,
      configFile: path.join(webRoot, 'vite.config.ts'),
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    }).finally(() => {
      process.env.NODE_ENV = nodeEnv;
    });
    const js = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    // Sanity: the bundle does contain the rest of the F05 UI.
    const all = js.map((f) => fs.readFileSync(path.join(outDir, 'assets', f), 'utf8')).join('\n');
    expect(all).toContain('Awaiting approval');
    expect(SIMULATOR_MARKERS.some((m) => all.includes(m))).toBe(false);
    expect(simulatorTraces(outDir)).toEqual([]);
  }, 180_000);
});

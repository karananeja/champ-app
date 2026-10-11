/**
 * Checks that a production build contains no trace of the dev-only technician simulator (F05, D-073).
 * Used by `pnpm build` (`node scripts/check-prod-bundle.ts dist`) and by `src/prod-bundle.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Strings that only the simulator panel and its API call contain. */
export const SIMULATOR_MARKERS = ['Simulate technician (dev only)', '/dev/fitments/'];

/** The files of a build directory (recursively) that contain a simulator marker. */
export function simulatorTraces(distDir: string): { file: string; marker: string }[] {
  const found: { file: string; marker: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|html|css|map)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const marker of SIMULATOR_MARKERS) if (text.includes(marker)) found.push({ file: path.relative(distDir, full), marker });
      }
    }
  };
  walk(distDir);
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dist = path.resolve(process.argv[2] ?? 'dist');
  const traces = simulatorTraces(dist);
  if (traces.length) {
    console.error(`The production bundle contains the dev simulator:\n${traces.map((t) => `  ${t.file}: "${t.marker}"`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Bundle check: no dev simulator in ${path.relative(process.cwd(), dist) || dist}`);
}

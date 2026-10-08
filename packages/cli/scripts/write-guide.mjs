// Writes the committed copies of the agent guide with the built CLI (`guide --form ...`), so each copy is exactly what
// an installed CLI prints. Run: pnpm --filter open-plan-cli build && pnpm --filter open-plan-cli guide:write
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDE_COPIES } from './guide-copies.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url)), cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
for (const { form, path } of GUIDE_COPIES) {
  const { text } = JSON.parse(execFileSync(process.execPath, [cli, 'guide', '--form', form, '--json'], { encoding: 'utf8' }));
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
  console.log(`Wrote ${path}`);
}

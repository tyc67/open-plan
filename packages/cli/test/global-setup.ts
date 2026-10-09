import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireRunLock, releaseRunLock } from './run-lock.js';

// The CLI tests run the built CLI, as a user or an agent does, so it is built first (its build builds core too).
// Vitest sets NODE_ENV=test, which would make the editor build (apps/web/dist, copied to dist/editor) a React
// development build; the browser checks and `serve` must get the production build.
//
// The build removes dist and writes it again, so two test runs at the same time break each other (a CLI start finds
// no dist/cli.js). One run at a time: the lock is held from before the build until the last test file ends, and a
// second run waits for it (run-lock.ts).
const LOCK = fileURLToPath(new URL('../.test-run.lock', import.meta.url));

export default async function setup() {
  await acquireRunLock(LOCK, { onWait: owner => process.stderr.write(`Waiting for another test run (process ${owner}) to end…\n`) });
  try {
    execSync('pnpm --filter open-plan-cli build', { cwd: new URL('../../..', import.meta.url), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  } catch (error) { releaseRunLock(LOCK); throw error; }
  return () => { releaseRunLock(LOCK); };
}

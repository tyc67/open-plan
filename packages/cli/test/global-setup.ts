import { execSync } from 'node:child_process';

// The CLI tests run the built CLI, as a user or an agent does, so it is built first (its build builds core too).
// Vitest sets NODE_ENV=test, which would make the editor build (apps/web/dist, copied to dist/editor) a React
// development build; the browser checks and `serve` must get the production build.
export default function setup() {
  execSync('pnpm --filter open-plan-cli build', { cwd: new URL('../../..', import.meta.url), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
}

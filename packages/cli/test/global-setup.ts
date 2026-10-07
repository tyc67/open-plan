import { execSync } from 'node:child_process';

// The CLI tests run the built CLI, as a user or an agent does, so it is built first (its build builds core too).
export default function setup() {
  execSync('pnpm --filter open-plan-cli build', { cwd: new URL('../../..', import.meta.url), stdio: 'inherit' });
}

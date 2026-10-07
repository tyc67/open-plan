import { execSync } from 'node:child_process';

// The CLI tests run the built CLI, as a user or an agent does, so core and the CLI are built first.
export default function setup() {
  execSync('pnpm --filter open-plan-core build && pnpm --filter open-plan-cli build', { cwd: new URL('../../..', import.meta.url), stdio: 'inherit' });
}

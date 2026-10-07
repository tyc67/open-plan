import { defineConfig } from 'vitest/config';

// Vitest covers core logic and the CLI. Browser checks (screenshots, editor behaviour) use tools/visual and tools/checks.
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts'], globalSetup: ['packages/cli/test/global-setup.ts'] } });

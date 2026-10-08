import { defineConfig } from 'vitest/config';

// Vitest covers core logic, the CLI and the web app's file-mode synchronization (apps/web/test). Browser checks
// (screenshots, editor behaviour) use tools/visual and tools/checks.
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.js'], globalSetup: ['packages/cli/test/global-setup.ts'] } });

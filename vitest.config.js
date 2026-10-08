import { defineConfig } from 'vitest/config';

// Vitest covers core logic, the CLI and the web app's file-mode synchronization (apps/web/test). Browser checks
// (screenshots, editor behaviour) use tools/visual and tools/checks.
// The MCP acceptance tests (roadmap C5b) start thousands of processes; they run in a second group, alone, after the
// other files, so that the timing of the other tests does not depend on them.
const ACCEPTANCE = 'packages/cli/test/mcp-acceptance.test.ts';
export default defineConfig({
  test: {
    globalSetup: ['packages/cli/test/global-setup.ts'],
    projects: [
      { extends: true, test: { name: 'main', include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.js'], exclude: [ACCEPTANCE] } },
      { extends: true, test: { name: 'acceptance', include: [ACCEPTANCE], sequence: { groupOrder: 1 } } },
    ],
  },
});

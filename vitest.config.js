import { defineConfig } from 'vitest/config';

// Vitest covers core logic only. Browser checks (screenshots, editor behaviour) use tools/visual.
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts'] } });

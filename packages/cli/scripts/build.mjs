// Bundles the CLI into one file, dist/cli.js (roadmap C2b): core and the text assets (the schema and the format
// description) are inside it, so an installed CLI needs no workspace package or repository file. resvg stays an npm
// dependency, because it has a native part for each platform. Core comes in through its public package exports (its
// compiled dist), the same interface as for any other user, so build core first.
import { build } from 'esbuild';
import { access, readFile, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// The same `?raw` imports that Vitest reads as text. The name in the bundle is relative to the repository, so the
// package holds no local path.
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => {
      const file = resolve(dirname(args.importer), args.path.slice(0, -4));
      return { path: relative(resolve(root, '../..'), file), namespace: 'raw', pluginData: file };
    });
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.pluginData, 'utf8'), loader: 'text' }));
  },
};
try { await access(fileURLToPath(import.meta.resolve('open-plan-core'))); } catch {
  console.error('open-plan-core is not built. Run `pnpm --filter open-plan-core build` first.'); process.exit(1);
}
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [resolve(root, 'src/cli.ts')], outfile: resolve(root, 'dist/cli.js'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['@resvg/resvg-js'],
  plugins: [raw], logLevel: 'warning',
});

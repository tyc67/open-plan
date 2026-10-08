// Bundles the CLI into one file, dist/cli.js (roadmap C2b): core and the text assets (the schema and the format
// description) are inside it, so an installed CLI needs no workspace package or repository file. resvg stays an npm
// dependency, because it has a native part for each platform. Core comes in through its public package exports (its
// compiled dist), the same interface as for any other user, so build core first.
import { build } from 'esbuild';
import { access, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
const { metafile } = await build({
  entryPoints: [resolve(root, 'src/cli.ts')], outfile: resolve(root, 'dist/cli.js'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['@resvg/resvg-js'],
  plugins: [raw], logLevel: 'warning', metafile: true,
});
// The npm packages inside the bundle (the MCP SDK and its dependencies, roadmap C5) keep their license texts:
// dist/THIRD-PARTY-NOTICES.txt has each package's name, version and license file.
const packages = new Map();
for (const input of Object.keys(metafile.inputs)) {
  const at = input.lastIndexOf(`node_modules${sep}`) >= 0 ? input.lastIndexOf(`node_modules${sep}`) : input.lastIndexOf('node_modules/');
  if (at < 0) continue;
  const parts = input.slice(at + 'node_modules/'.length).split(/[\\/]/);
  const dir = resolve(input.slice(0, at), 'node_modules', ...parts.slice(0, parts[0].startsWith('@') ? 2 : 1));
  if (!packages.has(dir)) packages.set(dir, JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')));
}
const notices = [];
for (const [dir, pkg] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  const file = (await readdir(dir)).find(f => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (!file) { console.error(`${pkg.name} is bundled but has no license file.`); process.exit(1); }
  notices.push(`${pkg.name} ${pkg.version} (${pkg.license})\n\n${(await readFile(join(dir, file), 'utf8')).trim()}\n`);
}
await writeFile(resolve(root, 'dist/THIRD-PARTY-NOTICES.txt'), `Open Plan CLI: npm packages bundled in cli.js, with their licenses.\n\n${notices.join(`\n${'-'.repeat(72)}\n\n`)}`);
// The editor for `serve` (roadmap C3): the web app's build output, served from dist/editor.
const editor = resolve(root, '../../apps/web/dist');
try { await access(resolve(editor, 'index.html')); } catch {
  console.error('apps/web is not built. Run `pnpm --filter open-plan-web build` first.'); process.exit(1);
}
await cp(editor, resolve(root, 'dist/editor'), { recursive: true });

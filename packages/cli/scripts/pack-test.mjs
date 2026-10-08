// Packed install test (roadmap C2b): packs the CLI, installs the package with npm in a new folder outside the
// repository, and runs the installed command. It shows that the installed CLI needs no workspace package and no
// repository file. It needs the npm registry (resvg is an npm dependency), so it is not part of `pnpm test`.
// Run: pnpm --filter open-plan-cli build && pnpm --filter open-plan-cli test:pack
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('..', import.meta.url)), repo = realpathSync(join(pkg, '../..'));
const work = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-pack-')));
if (work.startsWith(`${repo}/`)) throw new Error('The test folder must be outside the repository.');
const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) failures.push(name); };

try {
  execFileSync('pnpm', ['pack', '--pack-destination', work], { cwd: pkg, stdio: 'pipe' });
  const tarball = readdirSync(work).find(f => f.endsWith('.tgz'));
  const app = join(work, 'app');
  execFileSync('mkdir', [app]);
  writeFileSync(join(app, 'package.json'), '{ "private": true }\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', join(work, tarball)], { cwd: app, stdio: 'pipe' });

  const installed = join(app, 'node_modules/open-plan-cli');
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  check('the package has only package.json, dist/cli.js and the editor for serve (dist/editor)', JSON.stringify(readdirSync(installed).sort()) === '["dist","package.json"]' &&
    JSON.stringify(readdirSync(join(installed, 'dist')).sort()) === '["cli.js","editor"]' && readdirSync(join(installed, 'dist/editor')).includes('index.html'));
  check('the only runtime dependency is resvg', JSON.stringify(Object.keys(manifest.dependencies ?? {})) === '["@resvg/resvg-js"]', JSON.stringify(manifest.dependencies));
  check('open-plan-core is not installed', !readdirSync(join(app, 'node_modules')).includes('open-plan-core'));
  check('the bundle has no repository path', !readFileSync(join(installed, 'dist/cli.js'), 'utf8').includes(repo));

  const bin = join(app, 'node_modules/.bin/open-plan');
  const cli = (...args) => {
    const r = spawnSync(bin, [...args, '--json'], { cwd: app, encoding: 'utf8' });
    return { code: r.status, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })(), err: r.stderr };
  };
  const schema = cli('schema');
  check('schema', schema.code === 0 && schema.json.schema.title === 'Open Plan floor plan, schema version 2' && schema.json.description.startsWith('# Open Plan format'));
  check('new --sample', cli('new', 'plan.json', '--sample').code === 0);
  const validated = cli('validate', 'plan.json');
  check('validate', validated.code === 0 && validated.json.revision === createHash('sha256').update(readFileSync(join(app, 'plan.json'))).digest('hex'));
  writeFileSync(join(app, 'c.json'), JSON.stringify({ expectedRevision: validated.json.revision, commands: [{ op: 'set_plan_name', name: 'Packed' }] }));
  const applied = cli('apply', 'plan.json', 'c.json');
  check('apply', applied.code === 0 && JSON.parse(readFileSync(join(app, 'plan.json'), 'utf8')).name === 'Packed' && typeof applied.json.backup === 'string');
  check('info', cli('info', 'plan.json').json?.name === 'Packed');
  const rendered = cli('render', 'plan.json', 'plan.png', '--no-text', '--grid', '--width', '800');
  check('render', rendered.code === 0 && rendered.json.width === 800);
  // The same image as the workspace build of the CLI.
  const local = spawnSync(process.execPath, [join(pkg, 'dist/cli.js'), 'render', join(app, 'plan.json'), join(work, 'local.png'), '--no-text', '--grid', '--width', '800'], { encoding: 'utf8' });
  check('render gives the same bytes as the workspace build', local.status === 0 && readFileSync(join(app, 'plan.png')).equals(readFileSync(join(work, 'local.png'))));
  const restored = cli('restore', 'plan.json', applied.json?.backup ?? '');
  check('restore', restored.code === 0 && JSON.parse(readFileSync(join(app, 'plan.json'), 'utf8')).name !== 'Packed');
  console.log(`node ${process.version}, npm ${execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()}, ${process.platform} ${process.arch}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) { console.error(`${failures.length} check(s) failed.`); process.exit(1); }
console.log('Packed install test passed.');

// Packed install test (roadmap C2b): packs the CLI, installs the package with npm in a new folder outside the
// repository, and runs the installed command. It shows that the installed CLI needs no workspace package and no
// repository file, and that the installed `serve` gives the bundled editor and the file API. It needs the npm
// registry (resvg is an npm dependency), so it is not part of `pnpm test`.
// Run: pnpm --filter open-plan-cli build && pnpm --filter open-plan-cli test:pack
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
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
  check('the package has only package.json, dist/cli.js, its license notices and the editor for serve (dist/editor)', JSON.stringify(readdirSync(installed).sort()) === '["dist","package.json"]' &&
    JSON.stringify(readdirSync(join(installed, 'dist')).sort()) === '["THIRD-PARTY-NOTICES.txt","cli.js","editor"]' && readdirSync(join(installed, 'dist/editor')).includes('index.html'));
  check('the license notices name the bundled MCP SDK', readFileSync(join(installed, 'dist/THIRD-PARTY-NOTICES.txt'), 'utf8').includes('@modelcontextprotocol/sdk'));
  check('the only runtime dependency is resvg', JSON.stringify(Object.keys(manifest.dependencies ?? {})) === '["@resvg/resvg-js"]', JSON.stringify(manifest.dependencies));
  check('open-plan-core and the MCP SDK are not installed (they are in the bundle)', !readdirSync(join(app, 'node_modules')).includes('open-plan-core') && !readdirSync(join(app, 'node_modules')).includes('@modelcontextprotocol'));
  check('the bundle has no repository path', !readFileSync(join(installed, 'dist/cli.js'), 'utf8').includes(repo));

  const bin = join(app, 'node_modules/.bin/open-plan');
  const cli = (...args) => {
    const r = spawnSync(bin, [...args, '--json'], { cwd: app, encoding: 'utf8' });
    return { code: r.status, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })(), err: r.stderr };
  };
  const guide = cli('guide');
  const localGuide = spawnSync(process.execPath, [join(pkg, 'dist/cli.js'), 'guide', '--json'], { encoding: 'utf8' });
  check('guide: the installed CLI prints the whole guide, the same as the workspace build, with no repository link', guide.code === 0 &&
    guide.json.text.includes('#### `scale_plan`') && guide.json.text.includes('## Open Plan format (schemaVersion 2)') &&
    guide.json.text === JSON.parse(localGuide.stdout).text && !/\]\((?!https?:)/.test(guide.json.text));
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

  // serve from the installed package: the bundled editor and the file API, then a clean stop.
  const port = await new Promise(done => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
  const server = spawn(bin, ['serve', 'plan.json', '--no-open', '--json', '--port', String(port)], { cwd: app });
  try {
    const started = await new Promise((done, fail) => { server.stdout.once('data', d => done(JSON.parse(String(d)))); server.once('exit', code => fail(new Error(`serve ended with ${code}`))); });
    const base = `http://127.0.0.1:${port}`, token = new URL(started.url).hash.replace('#token=', '');
    const page = await fetch(`${base}/`).then(async r => ({ status: r.status, text: await r.text() }));
    const script = /<script[^>]+src="\/?([^"]+\.js)"/.exec(page.text)?.[1];
    const asset = script ? await fetch(`${base}/${script}`) : null;
    check('serve: the bundled editor page and its script', page.status === 200 && page.text.includes('<div id="root">') && asset?.status === 200 && /javascript/.test(asset.headers.get('content-type') ?? ''), script);
    const state = await fetch(`${base}/api/plan`, { headers: { 'x-open-plan-token': token } }).then(r => r.json());
    check('serve: the file API with the token gives the plan and its revision', state.ok && state.state.revision === createHash('sha256').update(readFileSync(join(app, 'plan.json'))).digest('hex') && state.state.plan.name === JSON.parse(readFileSync(join(app, 'plan.json'), 'utf8')).name);
    check('serve: the file API without the token is refused', (await fetch(`${base}/api/plan`)).status === 401);
  } finally {
    const ended = server.exitCode !== null ? Promise.resolve(server.exitCode) : new Promise(done => server.once('exit', code => done(code)));
    server.kill('SIGTERM');
    check('serve: stops cleanly on SIGTERM', (await ended) === 0);
  }
  // mcp from the installed package (roadmap C5): the handshake, one read and one write, and stdout with only MCP messages.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command: bin, args: ['mcp', '--root', app], cwd: work, stderr: 'pipe' });
  const client = new Client({ name: 'pack-test', version: '0' });
  const raw = [], unreadable = [];
  try {
    await client.connect(transport);
    const onmessage = transport.onmessage;
    transport.onmessage = message => { raw.push(message); onmessage?.(message); };
    // A stdout line that is not a JSON-RPC message is reported to onerror by the transport.
    const onerror = transport.onerror;
    transport.onerror = error => { unreadable.push(String(error)); onerror?.(error); };
    const tools = (await client.listTools()).tools.map(t => t.name);
    check('mcp: the handshake and the ten tools', client.getServerVersion()?.name === 'open-plan' && tools.length === 10 && tools.includes('apply_commands'), tools.join(' '));
    const readResult = (await client.callTool({ name: 'read_plan', arguments: { path: 'plan.json' } })).structuredContent;
    check('mcp: read_plan gives the revision of the file bytes', readResult?.ok && readResult.revision === createHash('sha256').update(readFileSync(join(app, 'plan.json'))).digest('hex'));
    const written = (await client.callTool({ name: 'apply_commands', arguments: { path: 'plan.json', expectedRevision: readResult?.revision, commands: [{ op: 'set_plan_name', name: 'From MCP' }] } })).structuredContent;
    check('mcp: apply_commands writes the plan, with a backup', written?.ok && JSON.parse(readFileSync(join(app, 'plan.json'), 'utf8')).name === 'From MCP' && typeof written.backup === 'string');
    check('mcp: every message on stdout is an MCP (JSON-RPC 2.0) message', raw.length >= 3 && raw.every(m => m.jsonrpc === '2.0') && unreadable.length === 0, unreadable.join('; ') || String(raw.length));
  } finally { await client.close(); }
  console.log(`node ${process.version}, npm ${execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()}, ${process.platform} ${process.arch}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) { console.error(`${failures.length} check(s) failed.`); process.exit(1); }
console.log('Packed install test passed.');

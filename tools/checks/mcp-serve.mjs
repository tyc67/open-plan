// Browser check for roadmap C5b: changes made through the MCP server appear live in the editor that `serve` opens,
// and the revision rules protect the user's edits in the editor from MCP writes.
// Usage: pnpm --filter open-plan-cli build && node tools/checks/mcp-serve.mjs   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLI = new URL('../../packages/cli/dist/cli.js', import.meta.url).pathname;
// The MCP SDK is a dependency of the CLI package; its client is used here as an agent's MCP client.
const sdk = path => import(pathToFileURL(createRequire(new URL('../../packages/cli/package.json', import.meta.url)).resolve(`@modelcontextprotocol/sdk/${path}`).replace('/dist/cjs/', '/dist/esm/')).href);
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const sha = data => createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(test, ms = 3000) {
  const started = Date.now();
  while (Date.now() - started < ms) { if (await test()) return Date.now() - started; await sleep(25); }
  return -1;
}

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-mcp-serve-'))), plan = join(dir, 'plan.json');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: dir, encoding: 'utf8' });
cli('new', 'plan.json', '--sample');
const fileJson = () => JSON.parse(readFileSync(plan, 'utf8')), revision = () => sha(readFileSync(plan));
const backups = () => existsSync(`${plan}.backups`) ? readdirSync(`${plan}.backups`).sort() : [];

const port = await new Promise(done => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
const server = spawn(process.execPath, [CLI, 'serve', 'plan.json', '--no-open', '--json', '--port', String(port)], { cwd: dir });
const started = await new Promise((done, fail) => { server.stdout.once('data', d => done(JSON.parse(String(d)))); server.once('exit', code => fail(new Error(`serve ended with ${code}`))); });
const client = new Client({ name: 'mcp-serve-check', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', '--root', dir], cwd: dir, stderr: 'pipe' }));
const tool = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  let page = await context.newPage();
  const errors = [], puts = [];
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith('/api/plan')) puts.push(Date.now()); }); };
  watch(page);
  const shownName = () => page.locator('header input').first().inputValue();
  const notice = kind => page.locator(`[data-file-notice="${kind}"]`);
  const xField = () => page.locator('.inspector label').filter({ hasText: /^X/ }).locator('input');
  const setX = async (id, x) => { await page.locator(`[data-furniture-id="${id}"]`).click(); await xField().fill(String(x)); await xField().press('Enter'); };
  const cx = (p, id) => p.furniture.find(f => f.id === id)?.cx;

  /**
   * Runs an MCP call and measures the live update. Observation starts before the call, so a slow MCP response cannot
   * hide a slow update: `fromCall` is from just before the call to the editor showing `name` (the checked figure), and
   * `fromFile` is from the moment the file revision changed.
   */
  async function liveUpdate(call, name) {
    const before = revision(), start = Date.now();
    let fileAt = -1, shownAt = -1;
    const fileWatch = (async () => { while (fileAt < 0 && Date.now() - start < 5000) { if (revision() !== before) fileAt = Date.now(); else await sleep(2); } })();
    const pageWatch = (async () => { while (shownAt < 0 && Date.now() - start < 5000) { if ((await shownName()) === name) shownAt = Date.now(); else await sleep(10); } })();
    const result = await call();
    await Promise.all([fileWatch, pageWatch]);
    const fromCall = shownAt < 0 ? -1 : shownAt - start, fromFile = shownAt < 0 || fileAt < 0 ? -1 : shownAt - fileAt;
    return { result, fromCall, fromFile, within: fromCall >= 0 && fromCall <= 1000, detail: `${fromCall} ms from the call, ${fromFile} ms from the file change` };
  }

  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');
  check('open: the editor shows the file plan', (await shownName()) === fileJson().name);

  // 1. apply_commands through MCP appears within 1 s, and loading it writes nothing back.
  await sleep(600);
  const putsBefore = puts.length;
  const read1 = (await tool('read_plan', { path: 'plan.json' })).revision;
  const live1 = await liveUpdate(() => tool('apply_commands', { path: 'plan.json', expectedRevision: read1, commands: [{ op: 'set_plan_name', name: 'From MCP' }] }), 'From MCP');
  const applied = live1.result;
  check('MCP apply_commands: the change appears in the editor within 1 s of the call', applied.ok && live1.within, live1.detail);
  await sleep(1200);
  check('MCP apply_commands: loading it writes nothing (same revision, no request)', revision() === applied.revision && puts.length === putsBefore, `${puts.length - putsBefore} writes`);

  // 2. write_plan (a whole plan) appears within 1 s, with one backup of the plan before it.
  const backupsBefore = backups().length, beforeWrite = readFileSync(plan, 'utf8');
  const whole = { ...fileJson(), name: 'Whole plan from MCP', furniture: fileJson().furniture.map(f => f.id === 'sample-f2' ? { ...f, cx: f.cx + 500 } : f) };
  const live2 = await liveUpdate(() => tool('write_plan', { path: 'plan.json', expectedRevision: revision(), plan: whole }), 'Whole plan from MCP');
  const written = live2.result;
  check('MCP write_plan: the whole plan appears in the editor within 1 s of the call', written.ok && live2.within, live2.detail);
  check('MCP write_plan: one backup with the plan before it', backups().length === backupsBefore + 1 && readFileSync(join(`${plan}.backups`, written.backup), 'utf8') === beforeWrite);

  // 3. An edit in the editor is saved to the file; an MCP batch with the revision from before it is refused.
  const seenByAgent = revision();
  await setX('sample-f1', 8000);
  check('editor edit: saved to the file', (await until(() => cx(fileJson(), 'sample-f1') === 8000)) >= 0);
  const stale = await tool('apply_commands', { path: 'plan.json', expectedRevision: seenByAgent, commands: [{ op: 'set_plan_name', name: 'Stale MCP' }] });
  check('MCP with an old revision: REVISION_CONFLICT with the current revision, and the editor edit stays', stale.code === 'REVISION_CONFLICT' && stale.currentRevision === revision() && cx(fileJson(), 'sample-f1') === 8000);

  // 4. After reading again, the batch is written and appears; the editor edit is kept.
  const read4 = (await tool('read_plan', { path: 'plan.json' })).revision;
  const live4 = await liveUpdate(() => tool('apply_commands', { path: 'plan.json', expectedRevision: read4, commands: [{ op: 'set_plan_name', name: 'MCP after reading again' }] }), 'MCP after reading again');
  check('MCP after reading again: written, appears within 1 s of the call, and the editor edit is in the plan', live4.result.ok && live4.within && cx(fileJson(), 'sample-f1') === 8000, live4.detail);

  // 5. An MCP change during a drag in the editor shows the conflict message, as a CLI change does (C3).
  const box = await page.locator('[data-furniture-id="sample-f2"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 3 });
  const during = await tool('apply_commands', { path: 'plan.json', expectedRevision: revision(), commands: [{ op: 'set_plan_name', name: 'MCP during drag' }] });
  check('MCP during a drag: the conflict message appears', during.ok && (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
  await page.mouse.up();
  await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
  check('載入檔案版本: the editor shows the MCP version, and the file is not written', (await until(async () => (await shownName()) === 'MCP during drag')) >= 0 && revision() === during.revision);

  // 6. After the editor is closed, `restore` brings back the plan from before the MCP write_plan; a new editor shows it.
  await page.close();
  const backupName = written.backup;
  const restored = cli('restore', 'plan.json', backupName);
  page = await context.newPage(); watch(page);
  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');
  check('restore after the editor is closed: the new editor shows the plan from the MCP backup', restored.status === 0 && readFileSync(plan, 'utf8') === beforeWrite && (await shownName()) === 'From MCP');
  check('MCP reads the restored plan', (await tool('read_plan', { path: 'plan.json' })).revision === sha(beforeWrite));

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await client.close();
  server.kill('SIGINT');
  await new Promise(done => server.once('exit', done));
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

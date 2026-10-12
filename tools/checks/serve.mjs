// Browser check for roadmap C3b: the editor in local file mode against a real `serve` process (the built CLI).
// Usage: pnpm --filter open-plan-cli build && node tools/checks/serve.mjs   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLI = new URL('../../packages/cli/dist/cli.js', import.meta.url).pathname;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const sha = data => createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-serve-'))), plan = join(dir, 'plan.json'), lock = `${plan}.lock`;
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: dir, encoding: 'utf8' });
cli('new', 'plan.json', '--sample');
const fileText = () => readFileSync(plan, 'utf8'), fileJson = () => JSON.parse(fileText()), revision = () => sha(readFileSync(plan));
const backups = () => existsSync(`${plan}.backups`) ? readdirSync(`${plan}.backups`).sort() : [];
/** A CLI batch, as an agent sends it. */
function apply(commands) {
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ expectedRevision: revision(), commands }));
  const r = cli('apply', 'plan.json', 'c.json');
  if (r.status !== 0) throw new Error(`apply failed: ${r.stdout}`);
  return JSON.parse(r.stdout).revision;
}
/** Waits until `test()` is true (up to `ms`), and returns the time it took, or -1. */
async function until(test, ms = 3000) {
  const started = Date.now();
  while (Date.now() - started < ms) { if (await test()) return Date.now() - started; await sleep(25); }
  return -1;
}
const freePort = () => new Promise(done => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });

const port = await freePort();
const server = spawn(process.execPath, [CLI, 'serve', 'plan.json', '--no-open', '--json', '--port', String(port)], { cwd: dir });
const started = await new Promise((done, fail) => { server.stdout.once('data', d => done(JSON.parse(String(d)))); server.once('exit', code => fail(new Error(`serve ended with ${code}`))); });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], puts = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith('/api/plan')) puts.push(Date.now()); });
  const notice = kind => page.locator(`[data-file-notice="${kind}"]`);
  const shownName = () => page.locator('header input').first().inputValue();
  const undoSteps = () => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(b => b.textContent.includes('步驟')).length);
  const xField = () => page.locator('.inspector label').filter({ hasText: /^X/ }).locator('input');
  const setX = async (id, x) => { await page.locator(`[data-furniture-id="${id}"]`).click(); await xField().fill(String(x)); await xField().press('Enter'); };
  const cx = (p, id) => p.furniture.find(f => f.id === id)?.cx;
  /** Starts a 2D drag on an item and keeps the button down: a gesture in progress. */
  const holdDrag = async id => {
    const box = await page.locator(`[data-furniture-id="${id}"]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 3 });
  };
  const idle = () => until(async () => (await page.locator('[data-file-notice]').count()) === 0 && fileJson() && true, 500);

  // 1. File mode opens the file, shows its mode and path, and never uses the website storage.
  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');
  const label = await page.locator('[data-storage-mode="file"]').innerText();
  check('mode: the indicator shows local file mode and the file', label.startsWith('本機檔案模式 · ') && label.endsWith('plan.json'), label);
  check('open: the editor shows the file plan', (await shownName()) === fileJson().name);
  const panelText = selector => page.locator(selector).first().textContent();
  check('mode: the privacy text and the storage help are for local file mode', (await panelText('[data-privacy]')).includes('本機檔案模式把資料存在你電腦上的檔案中') &&
    (await panelText('[data-storage-help]')).includes('plan.json') && !(await panelText('[data-storage-help]')).includes('瀏覽器內'));
  check('mode: no website session-snapshot button in file mode', (await page.getByRole('button', { name: '復原開始編輯前的平面圖' }).count()) === 0);

  // 2. A browser edit is written to the file; the session's first write backs the file up first, later ones do not.
  const original = fileText();
  await setX('sample-f1', 8000);
  const wrote = await until(() => cx(fileJson(), 'sample-f1') === 8000);
  check('browser to file: an edit is in the file', wrote >= 0, `${wrote} ms`);
  check('browser to file: the first write of the session backed up the file', backups().length === 1 && readFileSync(join(`${plan}.backups`, backups()[0]), 'utf8') === original);
  await setX('sample-f1', 8100); await until(() => cx(fileJson(), 'sample-f1') === 8100);
  check('browser to file: a later write makes no backup', backups().length === 1);
  check('website storage is not used', (await page.evaluate(() => localStorage.getItem('open-plan:document:v1'))) === null);

  // 3. File to browser: an agent's change loads at once when there is no unsaved edit, resets undo, and causes no write.
  // Step C "done when": an external edit appears in the open browser within 1 s (from the end of the write).
  await sleep(600);
  const putsBefore = puts.length;
  const agentRevision = apply([{ op: 'set_plan_name', name: 'From the agent' }]);
  const loaded = await until(async () => (await shownName()) === 'From the agent');
  check('file to browser: the agent change (CLI apply, an atomic rename) appears within 1 s', loaded >= 0 && loaded <= 1000, `${loaded} ms`);
  await sleep(1200);
  check('file to browser: loading it writes nothing (same revision, no request)', revision() === agentRevision && puts.length === putsBefore, `${puts.length - putsBefore} writes`);
  check('file to browser: the undo history starts again', (await undoSteps()) === 0);
  // A direct edit that leaves out the heights: the browser plan is normalized, but that is not a change to write.
  const normalized = fileJson(); for (const o of normalized.openings) { delete o.head; delete o.sill; } normalized.name = 'Minified, no heights';
  const minified = JSON.stringify(normalized); writeFileSync(plan, minified);
  const loaded2 = await until(async () => (await shownName()) === 'Minified, no heights');
  await sleep(1200);
  check('file to browser: a direct write of the file appears within 1 s', loaded2 >= 0 && loaded2 <= 1000, `${loaded2} ms`);
  check('file to browser: a normalized file version also causes no write', loaded2 >= 0 && fileText() === minified && puts.length === putsBefore, `${puts.length - putsBefore} writes`);

  // 4. Conflict during a gesture, resolved with 保留我的版本: the file gets the browser plan; the file version is backed up.
  await holdDrag('sample-f2');
  const external = apply([{ op: 'set_plan_name', name: 'Agent during drag' }]), externalText = fileText();
  check('conflict: a change during a drag shows the message', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
  await page.mouse.up();
  await sleep(800);
  check('conflict: no write while the message is open', revision() === external);
  await notice('conflict').getByRole('button', { name: '保留我的版本' }).click();
  await until(() => fileJson().name !== 'Agent during drag');
  const kept = fileJson();
  check('保留我的版本: the file has the browser plan', kept.name === 'Minified, no heights' && (await notice('conflict').count()) === 0, kept.name);
  check('保留我的版本: the file version was backed up first', backups().some(n => readFileSync(join(`${plan}.backups`, n), 'utf8') === externalText));

  // 5. Conflict while a field has focus, resolved with 載入檔案版本: the browser plan is kept as a -browser backup.
  await idle();
  await page.locator('[data-furniture-id="sample-f3"]').click(); await xField().fill('9999');      // typed, not committed
  const external2 = apply([{ op: 'set_plan_name', name: 'Agent while typing' }]);
  check('conflict: a change while a field has focus shows the message', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
  await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
  await until(async () => (await shownName()) === 'Agent while typing');
  const browserBackup = backups().find(n => n.endsWith('-browser.json'));
  check('載入檔案版本: the browser shows the file version, and the file is not written', (await shownName()) === 'Agent while typing' && revision() === external2);
  check('載入檔案版本: the browser plan (with the committed typed value) is a -browser backup', !!browserBackup && cx(JSON.parse(readFileSync(join(`${plan}.backups`, browserBackup), 'utf8')), 'sample-f3') === 9999);

  // 6. A stale conflict action: the file changed again after the message. The server refuses it, and the message is refreshed.
  await holdDrag('sample-f2'); apply([{ op: 'set_plan_name', name: 'Stale 1' }]);
  await until(async () => (await notice('conflict').count()) === 1); await page.mouse.up();
  await page.route('**/api/plan', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const body = JSON.parse(route.request().postData()); body.expectedRevision = sha('an older file');     // as if the message were older
    return route.continue({ postData: JSON.stringify(body) });
  });
  const beforeStale = fileText();
  await notice('conflict').getByRole('button', { name: '保留我的版本' }).click();
  check('stale action: refused, the message says the file changed again, and the file is unchanged',
    (await until(async () => (await notice('conflict').innerText()).includes('檔案又變更了一次'))) >= 0 && fileText() === beforeStale);
  await page.unroute('**/api/plan');
  await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
  await until(async () => (await notice('conflict').count()) === 0);

  // 7. Edits during a write in flight: one write at a time; the response marks only the plan it sent as saved.
  await sleep(600);
  writeFileSync(lock, `${JSON.stringify({ token: 'held-by-check', hostname: hostname(), pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  const putsAtStart = puts.length;
  await setX('sample-f1', 8300);
  await until(() => puts.length > putsAtStart);
  await setX('sample-f1', 8400);                                         // made while the first write waits for the lock
  await sleep(900);
  check('in-flight write: one request at a time', puts.length === putsAtStart + 1, `${puts.length - putsAtStart} requests`);
  unlinkSync(lock);
  const settled = await until(() => cx(fileJson(), 'sample-f1') === 8400, 5000);
  check('in-flight write: the later edit is written after the first response', settled >= 0 && puts.length === putsAtStart + 2, `${puts.length - putsAtStart} requests, file x ${cx(fileJson(), 'sample-f1')}`);

  // 8. A lock that cannot be checked (a stopped process) refuses the write; 重試 reads the revision and saves.
  writeFileSync(lock, `${JSON.stringify({ token: 'stale', hostname: hostname(), pid: 999999, createdAt: new Date().toISOString() })}\n`);
  await setX('sample-f1', 8500);
  check('write error: the message offers 重試', (await until(async () => (await notice('error').count()) === 1)) >= 0, await notice('error').innerText().catch(() => ''));
  unlinkSync(lock);
  await notice('error').getByRole('button', { name: '重試' }).click();
  check('write error: 重試 saves the edit', (await until(() => cx(fileJson(), 'sample-f1') === 8500)) >= 0 && (await notice('error').count()) === 0);

  // 9. An invalid file: the browser keeps its plan and writes nothing; a valid file afterwards loads (no unsaved edit).
  await sleep(600);
  const valid = fileText(), nameBefore = await shownName();
  writeFileSync(plan, valid.slice(0, 300));
  check('invalid file: the message shows, and the browser keeps its plan', (await until(async () => (await notice('invalid').count()) === 1)) >= 0 && (await shownName()) === nameBefore);
  const putsInvalid = puts.length;
  await setX('sample-f1', 8600); await sleep(1000);
  check('invalid file: an edit is not written', puts.length === putsInvalid && fileText() === valid.slice(0, 300));
  writeFileSync(plan, JSON.stringify({ ...JSON.parse(valid), name: 'Repaired file' }));
  check('invalid file: a valid file afterwards is a conflict, because the browser has an unsaved edit', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
  await notice('conflict').getByRole('button', { name: '保留我的版本' }).click();
  check('invalid file: 保留我的版本 writes the edit made while the file was invalid', (await until(() => cx(fileJson(), 'sample-f1') === 8600)) >= 0);

  // 11. Replacement in file mode: the browser plan is kept as -replaced; 復原上一個平面圖 brings it back as one undo step.
  await sleep(600);
  const beforeReplace = await shownName(), stepsBefore = await undoSteps();
  await page.getByRole('button', { name: '新增空白平面圖' }).first().click({ trial: false }).catch(async () => {
    await page.getByRole('button', { name: 'Open Plan 專案設定' }).click(); await page.getByRole('button', { name: '新增空白平面圖' }).first().click();
  });
  check('replace: a -replaced backup of the browser plan', (await until(() => backups().some(n => n.endsWith('-replaced.json')))) >= 0);
  check('replace: the empty plan is written to the file', (await until(() => fileJson().walls.length === 0)) >= 0);
  await page.locator('[data-replace-notice]').getByRole('button', { name: '復原上一個平面圖' }).click();
  check('restore: the plan before the replacement comes back and is written', (await until(async () => (await shownName()) === beforeReplace && fileJson().name === beforeReplace)) >= 0);
  check('restore: replacement and restore are one undo step each', (await undoSteps()) === stepsBefore + 2, `${stepsBefore} → ${await undoSteps()}`);

  // 11b. An edit made while the replacement backup or the restore read is pending is not replaced: the backup holds
  // only the plan from before the wait. The check holds the request until the edit is made.
  const holdRequest = async (pattern, method) => {
    let release;
    const released = new Promise(done => { release = done; });
    await page.route(pattern, async route => { if (route.request().method() !== method) return route.fallback(); await released; await route.fallback(); });
    return async () => { release(); await sleep(300); await page.unroute(pattern); };
  };
  const rename = async name => { await page.locator('header input').first().fill(name); await page.locator('header input').first().press('Tab'); };
  const clickNewPlan = () => page.getByRole('button', { name: '新增空白平面圖' }).first().click().catch(async () => {
    await page.getByRole('button', { name: 'Open Plan 專案設定' }).click(); await page.getByRole('button', { name: '新增空白平面圖' }).first().click();
  });
  const sampleText = fileText();
  let release = await holdRequest('**/api/browser-backups', 'POST');
  await clickNewPlan(); await sleep(300);
  await rename('Edited during the backup'); await release();
  check('replace: an edit made while the backup is pending stops the replacement, with a message', (await until(async () => (await page.locator('[data-replace-notice]').innerText()).includes('等待備份時又有新的修改'))) >= 0 &&
    (await shownName()) === 'Edited during the backup' && (await until(() => fileJson().name === 'Edited during the backup' && fileJson().walls.length > 0)) >= 0);
  await clickNewPlan();
  await until(() => fileJson().walls.length === 0);
  release = await holdRequest('**/api/backups', 'GET');
  await page.locator('[data-replace-notice]').getByRole('button', { name: '復原上一個平面圖' }).click(); await sleep(300);
  await rename('Edited during the restore'); await release();
  check('restore: an edit made while the backup is read stops the restore, with a message', (await until(async () => (await page.locator('[data-replace-notice]').innerText()).includes('讀取備份時又有新的修改'))) >= 0 &&
    (await shownName()) === 'Edited during the restore' && (await until(() => fileJson().name === 'Edited during the restore' && fileJson().walls.length === 0)) >= 0);

  // 12. A page close with an unsaved edit asks first.
  writeFileSync(lock, `${JSON.stringify({ token: 'held-by-check', hostname: hostname(), pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  await rename('Unsaved at close'); await sleep(500);
  const asked = new Promise(done => { page.once('dialog', d => { done(d.type()); d.dismiss(); }); setTimeout(() => done(null), 3000); });
  await page.close({ runBeforeUnload: true });
  check('page close: the browser asks while an edit is not in the file', (await asked) === 'beforeunload');
  unlinkSync(lock);
  writeFileSync(plan, sampleText);                                    // the later checks use the sample furniture

  // 13. A lost connection, through a proxy that can drop every connection: writes stop and the plan stays; when the
  // connection comes back, a change made meanwhile loads (no unsaved edit) or is a conflict (an unsaved edit).
  // The proxy gives the server its own Host and Origin, so the server's checks still apply.
  const proxySockets = new Set();
  let accepting = true;
  const proxy = createServer((req, res) => {
    if (!accepting) { req.socket.destroy(); return; }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    if (headers.origin) headers.origin = `http://127.0.0.1:${port}`;
    const upstream = request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  proxy.on('connection', socket => { proxySockets.add(socket); socket.on('close', () => proxySockets.delete(socket)); });
  const proxyPort = await new Promise(done => proxy.listen(0, '127.0.0.1', () => done(proxy.address().port)));
  const cut = () => { accepting = false; for (const socket of proxySockets) socket.destroy(); };
  const tab = await context.newPage();
  tab.on('pageerror', e => errors.push(e.message));
  await tab.goto(`http://127.0.0.1:${proxyPort}/#token=${started.url.split('token=')[1]}`); await tab.waitForSelector('svg.plan-svg');
  const tabName = () => tab.locator('header input').first().inputValue();
  const tabNotice = kind => tab.locator(`[data-file-notice="${kind}"]`);
  await sleep(600);
  cut();
  check('disconnect: the message shows', (await until(async () => (await tabNotice('disconnected').count()) === 1, 4000)) >= 0);
  const missed = apply([{ op: 'set_plan_name', name: 'Changed while offline' }]);
  accepting = true;
  check('reconnect: the change made meanwhile loads', (await until(async () => (await tabName()) === 'Changed while offline', 8000)) >= 0 && (await tabNotice('disconnected').count()) === 0);
  await sleep(1000);
  check('reconnect: loading it writes nothing', revision() === missed);
  cut();
  await until(async () => (await tabNotice('disconnected').count()) === 1, 4000);
  const tabX = tab.locator('.inspector label').filter({ hasText: /^X/ }).locator('input');
  await tab.locator('[data-furniture-id="sample-f4"]').click(); await tabX.fill('7777'); await tabX.press('Enter');
  await sleep(800);
  const offlineFile = fileText();
  check('disconnect: an edit stays in the browser and is not written', cx(JSON.parse(offlineFile), 'sample-f4') !== 7777);
  apply([{ op: 'set_plan_name', name: 'Changed again while offline' }]);
  accepting = true;
  check('reconnect with an unsaved edit: the change made meanwhile is a conflict', (await until(async () => (await tabNotice('conflict').count()) === 1, 8000)) >= 0);
  await tabNotice('conflict').getByRole('button', { name: '保留我的版本' }).click();
  check('reconnect with an unsaved edit: 保留我的版本 writes the edit', (await until(() => cx(fileJson(), 'sample-f4') === 7777)) >= 0);
  await tab.close(); proxy.close();

  // 12b. A drag that stops for longer than the autosave delay: its preview is not written to the file (old finding L6).
  writeFileSync(plan, sampleText);
  const held = await context.newPage(); let heldPuts = 0;
  held.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith('/api/plan')) heldPuts++; });
  await held.goto(started.url); await held.waitForSelector('svg.plan-svg'); await sleep(800);
  const heldStart = fileText(), heldBox = await held.locator('[data-furniture-id="sample-f2"]').boundingBox();
  await held.mouse.move(heldBox.x + heldBox.width / 2, heldBox.y + heldBox.height / 2); await held.mouse.down();
  await held.mouse.move(heldBox.x + heldBox.width / 2 + 40, heldBox.y + heldBox.height / 2 + 10, { steps: 3 });
  await sleep(1000);
  check('drag held: no write, and the file does not change', heldPuts === 0 && fileText() === heldStart, `${heldPuts} writes`);
  await held.mouse.up();
  check('drag released: the new position is written', (await until(() => cx(fileJson(), 'sample-f2') !== cx(JSON.parse(heldStart), 'sample-f2'))) >= 0);
  await sleep(800);
  const labelStart = fileText(), labelId = JSON.parse(labelStart).rooms[0].id, labelBox = await held.locator(`[data-room-label-id="${labelId}"]`).boundingBox(), labelPuts = heldPuts;
  await held.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2); await held.mouse.down();
  await held.mouse.move(labelBox.x + labelBox.width / 2 + 40, labelBox.y + labelBox.height / 2 + 30, { steps: 3 });
  await sleep(1000);
  check('label drag held: no write, and the file does not change', heldPuts === labelPuts && fileText() === labelStart, `${heldPuts - labelPuts} writes`);
  await held.mouse.up();
  check('label drag released: the new position is written', (await until(() => String(fileJson().rooms[0].at) !== String(JSON.parse(labelStart).rooms[0].at))) >= 0);

  // 12c. A drag that starts while 載入檔案版本 waits for the server: the file version is not loaded and not overwritten.
  const heldNotice = () => held.locator('[data-file-notice="conflict"]');
  const dragF2 = async () => {
    const box = await held.locator('[data-furniture-id="sample-f2"]').boundingBox();
    await held.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await held.mouse.down();
    await held.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 3 });
  };
  await sleep(800); await dragF2();
  apply([{ op: 'set_plan_name', name: 'Agent before a slow load' }]);
  await until(async () => (await heldNotice().count()) === 1); await held.mouse.up();
  let releaseLoad; const loadHeld = new Promise(done => { releaseLoad = done; });
  await held.route('**/api/load-file', async route => { await loadHeld; await route.fallback(); });
  await heldNotice().getByRole('button', { name: '載入檔案版本' }).click();
  await sleep(200); await dragF2();
  const slowRevision = revision();
  releaseLoad(); await sleep(600);
  check('drag during a slow 載入檔案版本: the load is refused with its reason', (await heldNotice().innerText()).includes('等待時又有新的修改'));
  await held.mouse.up(); await sleep(1000);
  check('drag during a slow 載入檔案版本: the file version is not overwritten', revision() === slowRevision && fileJson().name === 'Agent before a slow load', fileJson().name);
  await held.unroute('**/api/load-file');
  await held.close();

  // 13. Website mode on the same address shows the website indicator and has no access to the file.
  const website = await context.newPage();
  await website.goto(started.url.split('#')[0]); await website.waitForSelector('svg.plan-svg');
  check('website mode: the website indicator, not the file one', (await website.locator('[data-storage-mode="website"]').innerText()) === '網站模式 · 儲存在此瀏覽器' && (await website.locator('[data-storage-mode="file"]').count()) === 0);
  await website.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.kill('SIGINT');
  await new Promise(done => server.once('exit', done));
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

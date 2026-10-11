// Browser check for roadmap D4 as a whole: the gestures of D4a (add wall), D4b (opening drag) and D4c (room draft,
// point drag) share one cancel function. This check goes through them in one session, in local file mode against a
// real `serve`: after each cancel there is no old preview, no extra undo step and no write.
// Usage: pnpm --filter open-plan-cli build && node tools/checks/edit-gestures.mjs   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLI = new URL('../../packages/cli/dist/cli.js', import.meta.url).pathname;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const sha = data => createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));

const start = {
  schemaVersion: 2, id: 'gestures-check', name: 'Gestures check', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
  walls: [{ id: 'w1', type: 'n', a: [0, 0], b: [6000, 0], thickness: 200 }],
  openings: [{ id: 'd1', type: 'door', wallId: 'w1', offset: 1000, width: 900, hinge: 'start', swing: 'left', head: 2100 }],
  rooms: [{ id: 'r1', name: '客廳', mat: 'wood', poly: [[100, 100], [3000, 100], [3000, 3000], [100, 3000]], at: [1500, 1500] }],
  materials: { wood: { name: '橡木地板', sw: '#d8b88a' } },
  furniture: [], measurements: [], dimensions: [],
};

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-edit-gestures-'))), plan = join(dir, 'plan.json');
writeFileSync(plan, JSON.stringify(start, null, 2));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: dir, encoding: 'utf8' });
const fileText = () => readFileSync(plan, 'utf8'), fileJson = () => JSON.parse(fileText()), revision = () => sha(readFileSync(plan));
const wall = (id, p = fileJson()) => p.walls.find(w => w.id === id);
function apply(commands) {
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ expectedRevision: revision(), commands }));
  const r = cli('apply', 'plan.json', 'c.json');
  if (r.status !== 0) throw new Error(`apply failed: ${r.stdout}`);
}
async function until(test, ms = 3000) {
  const started = Date.now();
  while (Date.now() - started < ms) { if (await test()) return Date.now() - started; await sleep(25); }
  return -1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const freePort = () => new Promise(done => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const server = spawn(process.execPath, [CLI, 'serve', 'plan.json', '--no-open', '--json', '--port', String(await freePort())], { cwd: dir });
const started = await new Promise((done, fail) => { server.stdout.once('data', d => done(JSON.parse(String(d)))); server.once('exit', code => fail(new Error(`serve ended with ${code}`))); });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const notice = kind => page.locator(`[data-file-notice="${kind}"]`);
  const steps = () => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(b => b.textContent.includes('步驟')).map(b => b.textContent));
  const screen = ([x, y]) => page.evaluate(([px, py]) => { const svg = document.querySelector('svg.plan-svg'), p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM()); return [p.x, p.y]; }, [x, y]);
  const clickPlan = async point => { const [x, y] = await screen(point); await page.mouse.move(x, y); await page.mouse.click(x, y); };
  const toolButton = label => page.getByRole('button', { name: label }).first();
  const name = () => page.locator('header input').first().inputValue();
  const door = () => fileJson().openings[0];
  const count = selector => page.locator(selector).count();
  /** What the drawing shows of the three gestures and of the plan. */
  const drawing = async () => ({
    wallPreview: await count('[data-wall-preview]'), roomDraft: await count('[data-room-draft]'),
    door: await page.locator('[data-opening-hit="d1"]').evaluate(r => Number(r.getAttribute('x'))),
    room: await page.locator('polygon[data-room-id="r1"]').evaluate(p => p.getAttribute('points')),
  });
  const ROOM = start.rooms[0].poly.map(p => p.join(',')).join(' ');
  const clean = (d, doorAt) => d.wallPreview === 0 && d.roomDraft === 0 && d.door === doorAt && d.room === ROOM;
  /** Mouse down on a plan point and a move to another one; the button stays down. */
  async function press(from, to) { const [x0, y0] = await screen(from), [x1, y1] = await screen(to); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2); await page.mouse.move(x1, y1); }

  // The bytes of the file before the editor opens it: the same bytes later mean that nothing was written.
  const startText = fileText();
  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');

  // 1. A first point of the add-wall tool, then the add-room tool: the wall point is dropped.
  await toolButton('新增牆').click();
  await clickPlan([4000, 2000]);
  { const [x, y] = await screen([4000, 3000]); await page.mouse.move(x, y); }
  check('wall tool: the first point shows a preview', (await count('[data-wall-preview]')) === 1);
  await toolButton('新增空間').click();
  check('wall point → room tool: the wall preview is dropped', (await until(async () => (await count('[data-wall-preview]')) === 0, 1000)) >= 0);

  // 2. A room draft, then Escape; then the wall tool again: no point of the room draft or of the old wall is left.
  await clickPlan([4000, 2000]); await clickPlan([5500, 2000]); await clickPlan([5500, 3500]);
  check('room tool: three taps are a draft of three points, and there is no wall preview', (await count('[data-room-draft-point]')) === 3 && (await count('[data-wall-preview]')) === 0);
  await page.keyboard.press('Escape');
  check('room draft → Escape: the draft is dropped', (await count('[data-room-draft]')) === 0);
  await toolButton('新增牆').click();
  { const [x, y] = await screen([4500, 2500]); await page.mouse.move(x, y); await sleep(200); }
  check('room draft → wall tool: a pointer move shows no preview (no first point is left from before)', (await count('[data-wall-preview]')) === 0);
  await clickPlan([4000, 2000]);
  await toolButton('新增空間').click(); await until(async () => (await count('[data-wall-preview]')) === 0, 1000);
  await clickPlan([4000, 2000]);
  await toolButton('選取物件').click();
  check('room draft → select tool: the draft is dropped', (await until(async () => (await count('[data-room-draft]')) === 0, 1000)) >= 0);
  await sleep(700);
  check('so far: no undo step, no write, and the drawing is the plan', (await steps()).length === 0 && fileText() === startText && clean(await drawing(), 1000), JSON.stringify(await drawing()));

  // 3. An opening drag with undo during it (nothing to undo yet), then a real drag, then undo and redo during drags.
  await clickPlan([1450, 0]);
  await press([1450, 0], [2450, 0]);
  check('opening drag: the preview moves the door', (await drawing()).door === 2000);
  await page.keyboard.press('ControlOrMeta+z'); await sleep(100);
  const afterUndo = await drawing();
  await page.mouse.up(); await sleep(700);
  check('opening drag → undo with no step: the drag is dropped, and the pointer up is no edit', clean(afterUndo, 1000) && (await steps()).length === 0 && fileText() === startText, JSON.stringify(afterUndo));
  await clickPlan([1450, 0]);
  await press([1450, 0], [2450, 0]); await page.mouse.up();
  check('opening drag: a finished drag is one step, in the file', (await until(() => door().offset === 2000)) >= 0 && (await steps()).length === 1);
  await press([2450, 0], [3450, 0]);
  await page.keyboard.press('ControlOrMeta+z'); await sleep(100);
  await page.mouse.up();
  check('opening drag → undo: the earlier step is undone, the drag is dropped, and no step is added', (await until(() => door().offset === 1000)) >= 0 && (await steps()).length === 0 && clean(await drawing(), 1000), JSON.stringify(await drawing()));
  await clickPlan([1450, 0]);
  await press([1450, 0], [3450, 0]);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await sleep(100);
  await page.mouse.up();
  check('opening drag → redo: the step is done again, the drag is dropped, and the door is where the step put it', (await until(() => door().offset === 2000)) >= 0 && (await steps()).length === 1 && clean(await drawing(), 2000), JSON.stringify(await drawing()));

  // 4. A room point drag, dropped by a change of tool with the keyboard (M), then a room draft dropped by undo.
  await clickPlan([600, 2500]);
  await press([3000, 3000], [3400, 3500]);
  check('room point drag: the preview moves the point', (await drawing()).room !== ROOM);
  await page.keyboard.press('m'); await sleep(300);
  const afterTool = await drawing();
  await page.mouse.up(); await sleep(700);
  check('room point drag → M (measure tool): the drag is dropped, and the pointer up is no edit', afterTool.room === ROOM && same(fileJson().rooms, start.rooms) && (await steps()).length === 1);
  await toolButton('新增空間').click();
  await clickPlan([4000, 2000]); await clickPlan([5500, 2000]); await clickPlan([5500, 3500]);
  await page.keyboard.press('ControlOrMeta+z');
  check('room draft → undo: the draft is dropped, and the step is undone', (await count('[data-room-draft]')) === 0 && (await until(() => door().offset === 1000)) >= 0 && (await steps()).length === 0);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await until(() => door().offset === 2000);

  // 5. A wall point and a restore from the history: the point is dropped, and the restore is one step.
  await toolButton('新增牆').click();
  await clickPlan([4000, 2000]);
  { const [x, y] = await screen([4000, 3000]); await page.mouse.move(x, y); }
  check('wall tool: a first point again', (await count('[data-wall-preview]')) === 1);
  await page.getByRole('tab', { name: '歷史紀錄' }).first().click();
  await page.locator('#history-content button').filter({ hasText: '步驟' }).first().click();
  check('wall point → history restore: the plan from before the step is in the file, as one more step', (await until(() => same(fileJson(), start))) >= 0 && (await steps()).length === 2, (await steps()).join(' | '));
  await toolButton('選取物件').click(); await sleep(300);
  check('after the restore: no old preview, and the drawing is the plan', clean(await drawing(), 1000), JSON.stringify(await drawing()));

  // 6. Nothing is left: the file has the content of the start plan (the editor wrote it again, so not the same bytes), and a change from outside loads with no conflict.
  await sleep(700);
  check('end: the file has exactly the content of the start plan, with 2 steps in the history (the drag and the restore)', same(fileJson(), start) && (await steps()).length === 2);
  apply([{ op: 'set_plan_name', name: 'Agent after the gestures' }]);
  check('end: the editor is not busy (a change from outside loads, with no conflict)', (await until(async () => (await name()) === 'Agent after the gestures')) >= 0 && (await notice('conflict').count()) === 0);
  await clickPlan([600, 2500]);
  check('end: a room can be selected and shows its handles', (await count('[data-room-handle]')) === 4);
  check('the plan is valid for the CLI', cli('validate', 'plan.json').status === 0);

  // 7. At 1024 × 768 the canvas toolbar is wider than the canvas (D4 added 2 tool buttons). Its last buttons are
  // reached with the scroll arrow of the toolbar, and they work.
  { const small = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
    small.on('pageerror', e => errors.push(e.message));
    await small.goto(started.url); await small.waitForSelector('svg.plan-svg');
    const toolbar = small.locator('[role="toolbar"][aria-label="畫布工具"]'), arrow = small.getByRole('button', { name: '向右捲動工具列' });
    /** True when the centre of the button is inside the visible part of the toolbar. */
    const visible = label => small.getByRole('button', { name: label, exact: true }).first().evaluate(b => { const r = b.getBoundingClientRect(), v = b.closest('[data-toolbar-scroll]').getBoundingClientRect(), x = (r.left + r.right) / 2; return x > v.left && x < v.right; });
    const ratio = () => small.locator('[data-scale-ratio] select').first().evaluate(s => s.options[0].textContent);
    check('1024 × 768: the toolbar has the scroll arrow, and 顯示整張平面圖 is outside the visible part', (await arrow.count()) === 1 && !(await visible('顯示整張平面圖')) && (await toolbar.count()) === 1);
    check('1024 × 768: the tools of D4 are visible with no scroll', (await visible('新增牆')) && (await visible('新增空間')));
    await arrow.click(); await sleep(400);
    check('1024 × 768: after the scroll arrow, 放大 and 顯示整張平面圖 are visible', (await visible('放大')) && (await visible('顯示整張平面圖')));
    const before = await ratio();
    await small.getByRole('button', { name: '放大', exact: true }).first().click(); await sleep(300);
    const zoomed = await ratio();
    await small.getByRole('button', { name: '顯示整張平面圖', exact: true }).first().click(); await sleep(300);
    check('1024 × 768: 放大 and 顯示整張平面圖 work there', zoomed !== before && (await ratio()) === before, `${before} → ${zoomed} → ${await ratio()}`);
    await small.close(); }

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

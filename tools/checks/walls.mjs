// Browser check for roadmap D4a: wall editing through the core commands, in local file mode against a real `serve`.
// Usage: pnpm --filter open-plan-cli build && node tools/checks/walls.mjs   Exit code 0 means every check passed.
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

// An agent's plan with one extra wall ("extra", with a door, and a room edge on its face), two walls that can be
// joined ("p1", "p2"), and a wall that an opening fills completely ("full": no solid part to click).
const start = {
  schemaVersion: 2, id: 'walls-check', name: 'Walls check', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
  walls: [
    { id: 'outer', type: 'e', a: [0, 0], b: [6000, 0], thickness: 200 },
    { id: 'extra', type: 'n', a: [2000, 1000], b: [2000, 3000], thickness: 120 },
    { id: 'p1', type: 'n', a: [0, 4000], b: [3000, 4000], thickness: 120 },
    { id: 'p2', type: 'n', a: [3000, 4000], b: [6000, 4000], thickness: 120 },
    { id: 'full', type: 'n', a: [0, 6000], b: [900, 6000], thickness: 120 },
  ],
  openings: [
    { id: 'd1', type: 'door', wallId: 'extra', offset: 300, width: 900, hinge: 'start', swing: 'left', head: 2100 },
    { id: 'h1', type: 'hole', wallId: 'full', offset: 0, width: 900, head: 2100 },
  ],
  rooms: [{ id: 'r1', name: '客廳', mat: 'wood', poly: [[2060, 1000], [5000, 1000], [5000, 3000], [2060, 3000]] }],
  materials: { wood: { name: '橡木地板', sw: '#d8b88a' } },
  furniture: [], measurements: [], dimensions: [],
};

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-walls-'))), plan = join(dir, 'plan.json');
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
  const editNotice = tone => page.locator(`[data-edit-notice${tone ? `="${tone}"` : ''}]`);
  const panel = id => page.locator(`[data-wall-panel${id ? `="${id}"` : ''}]`);
  const field = name => page.locator(`[data-wall-field="${name}"]`);
  const steps = () => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(b => b.textContent.includes('步驟')).map(b => b.textContent));
  const select = (id, pointerType = 'mouse') => page.locator(`[data-wall-line="${id}"]`).dispatchEvent('pointerdown', { button: 0, pointerType, isPrimary: true });
  const type = async (name, value) => { await field(name).fill(String(value)); await field(name).press('Enter'); };
  /** The screen position of a plan point. */
  const screen = ([x, y]) => page.evaluate(([px, py]) => { const svg = document.querySelector('svg.plan-svg'), p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM()); return [p.x, p.y]; }, [x, y]);
  const clickPlan = async point => { const [x, y] = await screen(point); await page.mouse.move(x, y); await page.mouse.click(x, y); };
  const undo = () => page.keyboard.press('ControlOrMeta+z');

  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');

  // 1. Selection: a wall with a solid part, and a wall that an opening fills completely.
  check('setup: the wall "full" has no solid part', (await page.locator('rect[data-wall-id="full"]').count()) === 0 && (await page.locator('rect[data-wall-id="outer"]').count()) >= 1);
  await select('full');
  check('select: the centre-line hit area selects a wall with no solid part', (await panel('full').count()) === 1);
  await page.locator('rect[data-wall-id="outer"]').first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  check('select: a solid part selects its wall, and the ends a and b are marked', (await panel('outer').count()) === 1 && (await page.locator('[data-wall-end-mark]').evaluateAll(marks => marks.map(m => m.textContent).join(''))) === 'ab');

  // 2. Thickness, type and name: each is one command and one undo step; a refused value changes nothing.
  await type('thickness', 240);
  check('thickness: the new value is in the file', (await until(() => wall('outer').thickness === 240)) >= 0);
  check('thickness: one undo step with its label', same(await steps(), ['步驟 1 前 · 變更牆體厚度']), (await steps()).join(' | '));
  const beforeRefusal = fileText();
  await type('thickness', 5000); await sleep(600);
  check('refused: a thickness out of range changes nothing, and the field shows the value of the plan', fileText() === beforeRefusal && (await field('thickness').inputValue()) === '240' && (await steps()).length === 1);
  check('refused: the reasons show, with the field name and no command path', (await editNotice('error').innerText()).includes('厚度：') && !(await editNotice('error').innerText()).includes('commands['), (await editNotice().innerText().catch(() => '')).replace(/\n/g, ' / '));
  await select('p1');
  check('refused: the reasons stay when another wall is selected', (await editNotice('error').count()) === 1);
  await page.locator('[data-edit-notice-close]').click();
  check('refused: the close button removes the reasons', (await editNotice().count()) === 0);
  await field('type').selectOption('low');
  check('type: the new type is in the file', (await until(() => wall('p1').type === 'low')) >= 0);
  await field('type').selectOption('n'); await until(() => wall('p1').type === 'n');
  await type('name', '走廊牆');
  check('name: the name is in the file', (await until(() => wall('p1').name === '走廊牆')) >= 0);

  // 3. Join (a candidate from the list), then split at a typed distance from a.
  check('join: the list has only the wall that can be joined', same(await field('join').locator('option').evaluateAll(o => o.map(x => x.value)), ['p2']));
  await page.locator('[data-wall-join]').click();
  check('join: one wall with the whole length; the other wall is gone', (await until(() => !wall('p2') && same(wall('p1').b, [6000, 4000]))) >= 0);
  check('join: the joined wall stays selected, with no join candidate now', (await panel('p1').count()) === 1 && (await field('join').count()) === 0);
  check('split: the field starts at the middle of the wall', (await field('split').inputValue()) === '3000');
  await field('split').fill('1500'); await page.locator('[data-wall-split]').click();
  check('split: the wall ends at the typed distance from a, and a new wall has the rest', (await until(() => same(wall('p1').b, [1500, 4000]) && fileJson().walls.some(w => same(w.a, [1500, 4000]) && same(w.b, [6000, 4000])))) >= 0);
  await field('split').fill('9000'); await page.locator('[data-wall-split]').click();
  check('split: a point off the wall is refused with a reason', (await until(async () => (await editNotice('error').count()) === 1)) >= 0 && (await editNotice('error').innerText()).includes('分割位置必須在牆的兩端之間'));

  // 4. Length: the chosen end moves, and the other end stays.
  await type('length', 1000);
  check('length: end b moves by default, and the refusal message is gone', (await until(() => same(wall('p1').a, [0, 4000]) && same(wall('p1').b, [1000, 4000]))) >= 0 && (await editNotice().count()) === 0);
  await page.locator('[data-wall-end="a"]').check();
  await type('length', 600);
  check('length: end a moves when it is chosen, and end b stays', (await until(() => same(wall('p1').a, [400, 4000]) && same(wall('p1').b, [1000, 4000]))) >= 0, JSON.stringify(wall('p1')));

  // 5. A shorter wall must keep its openings inside; reverse keeps the door in its place.
  await select('extra');
  const beforeShort = fileText();
  await type('length', 1000); await sleep(600);
  check('length: a wall that would leave its door outside is refused', fileText() === beforeShort && (await editNotice('error').innerText()).includes('超出牆的長度'));
  await page.locator('[data-wall-reverse]').click();
  check('reverse: a and b are exchanged, and the door has the same place in the plan', (await until(() => same(wall('extra').a, [2000, 3000]) && same(wall('extra').b, [2000, 1000]))) >= 0 && fileJson().openings.find(o => o.id === 'd1').offset === 800 && fileJson().openings.find(o => o.id === 'd1').hinge === 'end');
  await undo(); await until(() => same(wall('extra').a, [2000, 1000]));

  // 6. Demolition goes through the core command.
  await select('extra');
  await page.locator('[data-wall-demolish]').click();
  check('demolition: the mark is in the file, with its history label', (await until(() => wall('extra').demolished === true)) >= 0 && (await steps()).at(0).includes('標記拆除牆體'), (await steps()).at(0));
  await page.locator('[data-wall-demolish]').click(); await until(() => !wall('extra').demolished);
  await select('outer');
  check('demolition: not offered for an exterior wall', await page.locator('[data-wall-demolish]').isDisabled());

  // 7. Delete the extra wall: its door goes with it, the notes stay visible, and one undo brings both back.
  await select('extra');
  check('delete: the button names the opening that goes with the wall', (await page.locator('[data-wall-delete]').innerText()).includes('1 個開口'));
  const beforeDelete = fileJson(), stepsBeforeDelete = (await steps()).length;
  await page.locator('[data-wall-delete]').click();
  check('delete: the wall and its door are not in the file', (await until(() => !wall('extra') && !fileJson().openings.some(o => o.id === 'd1'))) >= 0);
  check('delete: one undo step, and the wall panel is closed', (await steps()).length === stepsBeforeDelete + 1 && (await steps()).at(0).includes('刪除牆體') && (await panel().count()) === 0);
  const info = await editNotice('info').innerText();
  check('delete: the notes name the deleted opening and the room that lost its wall', info.includes('1 個開口也一併刪除') && info.includes('1 個空間的外框不再貼著牆面'), info.replace(/\n/g, ' / '));
  check('delete: the room outline is not changed', same(fileJson().rooms, beforeDelete.rooms));
  await page.locator('[data-edit-notice-room="r1"]').click();
  check('delete: the note has an action that selects the room', (await page.locator('.selected-room-outline').count()) === 1 && (await editNotice('info').count()) === 1);
  await undo();
  check('undo: the wall and its door are back, exactly', (await until(() => same(fileJson(), beforeDelete))) >= 0);
  check('undo: the notes close', (await editNotice().count()) === 0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  check('redo: the wall is deleted again', (await until(() => !wall('extra'))) >= 0);

  // 8. Add a wall with two points on the drawing: a preview that writes nothing, then one command.
  const count = () => fileJson().walls.length, wallsBefore = count();
  await page.getByRole('button', { name: '新增牆' }).first().click();
  check('add: the tool shows its form in the panel', (await page.locator('[data-add-wall-panel]').count()) === 1);
  await clickPlan([4010, 4990]);                                            // goes to the 10 mm grid
  const [mx, my] = await screen([4030, 6480]); await page.mouse.move(mx, my);
  await sleep(500);
  check('add: after the first point there is a preview, and nothing is written', (await page.locator('[data-wall-preview]').count()) === 1 && count() === wallsBefore);
  await page.keyboard.press('Escape');
  check('add: Escape drops the first point', (await page.locator('[data-wall-preview]').count()) === 0);
  await clickPlan([4010, 4990]); await clickPlan([4200, 6480]);
  const added = () => fileJson().walls.find(w => !['outer', 'p1', 'full'].includes(w.id) && w.a[1] !== 4000);
  check('add: the wall is in the file, vertical, with the thickness of the nearest wall', (await until(() => count() === wallsBefore + 1 && !!added())) >= 0 && added().a[0] === added().b[0] && added().thickness === 120 && added().type === 'n', JSON.stringify(added()));
  check('add: one undo step with its label, and the tool stays active', (await steps()).at(0).includes('新增牆') && (await page.locator('[data-add-wall-panel]').count()) === 1);

  // 9. Add a wall from the panel (no gesture): the same command with typed values.
  for (const [name, value] of [['x', 1000], ['y', 5000], ['length', 2000]]) await page.locator(`[data-add-wall="${name}"]`).fill(String(value));
  await page.locator('[data-add-wall="direction"]').selectOption('down');
  await page.locator('[data-add-wall="type"]').selectOption('low');
  await page.locator('[data-add-wall-submit]').click();
  check('add from the panel: the wall has the typed start, direction, length and type', (await until(() => fileJson().walls.some(w => same(w.a, [1000, 5000]) && same(w.b, [1000, 7000]) && w.type === 'low'))) >= 0);
  await page.locator('[data-add-wall="x"]').fill('0'); await page.locator('[data-add-wall="y"]').fill('0'); await page.locator('[data-add-wall="length"]').fill('abc');
  check('add from the panel: no length, no action', await page.locator('[data-add-wall-submit]').isDisabled());

  // 9b. The first point is dropped by: a wall from the panel, a cancelled pointer, a restore from the history, and a
  // second finger (pinch). None of these adds a wall or leaves the editor busy.
  const preview = () => page.locator('[data-wall-preview]').count();
  const svgEvent = (type, point, init) => page.locator('svg.plan-svg').dispatchEvent(type, { bubbles: true, cancelable: true, button: 0, isPrimary: true, clientX: point[0], clientY: point[1], ...init });
  const tap = async (planPoint, init = { pointerType: 'touch', pointerId: 11 }) => { const p = await screen(planPoint); await svgEvent('pointerdown', p, init); await svgEvent('pointerup', p, init); };
  let walls = count();
  await tap([5000, 5000]);
  check('touch: a tap places the first point', (await preview()) === 1 && count() === walls);
  await tap([5000, 6500]);
  check('touch: a second tap adds the wall', (await until(() => count() === walls + 1)) >= 0 && (await preview()) === 0);
  walls = count();
  await tap([5500, 5000]);
  for (const [name, value] of [['x', 3000], ['y', 5000], ['length', 500]]) await page.locator(`[data-add-wall="${name}"]`).fill(String(value));
  await page.locator('[data-add-wall-submit]').click();
  check('panel after a first point: the wall from the panel is added and the first point is dropped', (await until(() => count() === walls + 1)) >= 0 && (await preview()) === 0);
  walls = count();
  await tap([5500, 5000]);
  { const p = await screen([5500, 5600]); await svgEvent('pointerdown', p, { pointerType: 'touch', pointerId: 12 }); await svgEvent('pointercancel', p, { pointerType: 'touch', pointerId: 12 }); }
  check('cancelled pointer: the first point is dropped and no wall is added', (await preview()) === 0 && count() === walls);
  await tap([5500, 5000]);
  { const p = await screen([5500, 5600]), q = await screen([5200, 5300]);
    await svgEvent('pointerdown', p, { pointerType: 'touch', pointerId: 13 }); await svgEvent('pointerdown', q, { pointerType: 'touch', pointerId: 14, isPrimary: false });
    await svgEvent('pointerup', q, { pointerType: 'touch', pointerId: 14, isPrimary: false }); await svgEvent('pointerup', p, { pointerType: 'touch', pointerId: 13 }); }
  await sleep(600);
  check('pinch after the first point: no wall is added, and the first point is dropped', count() === walls && (await preview()) === 0);
  await tap([5500, 5000]);
  await page.getByRole('tab', { name: '歷史紀錄' }).first().click();
  const restored = count();
  await page.locator('#history-content button').filter({ hasText: '步驟' }).first().click();
  check('history restore after the first point: the first point is dropped', (await until(() => count() !== restored)) >= 0 && (await preview()) === 0);
  // The restored plan is in the file now (the wait above), so the editor has no unsaved edit: a change from outside
  // must load. A first point that was still there would make it a conflict.
  await sleep(400);
  apply([{ op: 'set_plan_name', name: 'Agent after the restore' }]);
  check('history restore after the first point: the editor is not busy (a change from outside loads, with no conflict)', (await until(async () => (await page.locator('header input').first().inputValue()) === 'Agent after the restore')) >= 0 && (await notice('conflict').count()) === 0);
  await page.getByRole('tab', { name: '物件屬性' }).first().click();

  // 9c. Space (pan) and M (measure) change the tool; they must not open a properties panel that the user closed.
  await page.getByRole('button', { name: '選取物件' }).first().click();
  await select('outer');
  const propertiesTab = page.getByRole('tab', { name: '物件屬性' }).first();
  await propertiesTab.click();                                               // the active tab: this closes the side panel
  const closed = async () => (await propertiesTab.getAttribute('aria-selected')) !== 'true';
  check('panel: the user closed the properties panel', await closed());
  await page.evaluate(() => document.activeElement?.blur());                  // Space on a focused tab would operate the tab
  await page.keyboard.down('Space'); await sleep(200); const duringSpace = await closed(); await page.keyboard.up('Space');
  await page.keyboard.press('m'); await sleep(200);
  check('panel: Space and M do not open it again', duringSpace && await closed());
  await page.getByRole('button', { name: '新增牆' }).first().click();
  await sleep(300);
  check('panel: the add-wall tool opens it', !(await closed()) && (await page.locator('[data-add-wall-panel]').count()) === 1, `pressed ${await page.getByRole('button', { name: '新增牆' }).first().getAttribute('aria-pressed')}, tab ${await propertiesTab.getAttribute('aria-selected')}, form ${await page.locator('[data-add-wall-panel]').count()}`);

  // 10. A change from outside after the first point is a conflict; loading the file version drops the point.
  const beforeConflict = count();
  await clickPlan([5000, 5000]);
  apply([{ op: 'set_plan_name', name: 'Agent during the wall' }]);
  check('conflict: a change from outside during the gesture shows the message', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
  await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
  await until(async () => (await page.locator('header input').first().inputValue()) === 'Agent during the wall');
  check('conflict: the file version loads, and the first point is dropped', (await page.locator('[data-wall-preview]').count()) === 0 && count() === beforeConflict);

  // 11. Touch selection, and the 3D view on the edited plan.
  await page.getByRole('button', { name: '選取物件' }).first().click();
  await page.locator('[data-wall-line="outer"]').dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  check('after the load: a wall can be selected and edited again', (await panel('outer').count()) === 1);
  await page.getByRole('button', { name: '3D 檢視' }).first().click();
  await page.waitForSelector('[aria-label="3D floor-plan view"] canvas'); await sleep(1500);
  check('3D: the view opens on the edited plan', (await page.locator('[aria-label="3D floor-plan view"] canvas').count()) === 1);
  check('the edited plan is readable for the CLI', cli('info', 'plan.json').status === 0);

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

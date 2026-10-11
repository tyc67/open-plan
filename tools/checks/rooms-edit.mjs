// Browser check for roadmap D4c: room editing through the core commands, in local file mode against a real `serve`.
// Usage: pnpm --filter open-plan-cli build && node tools/checks/rooms-edit.mjs   Exit code 0 means every check passed.
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

// Two rooms beside two walls. The ceiling is 3000 mm, so the wall area in the panel must not use a fixed 2.8 m.
const start = {
  schemaVersion: 2, id: 'rooms-check', name: 'Rooms check', units: 'mm', locale: 'zh-TW', ceilingHeight: 3000,
  walls: [
    { id: 'top', type: 'n', a: [0, 0], b: [6000, 0], thickness: 200 },
    { id: 'left', type: 'n', a: [0, 100], b: [0, 4000], thickness: 200 },
  ],
  openings: [],
  rooms: [
    { id: 'r1', name: '客廳', mat: 'wood', poly: [[100, 100], [3000, 100], [3000, 3000], [100, 3000]], at: [1500, 1500] },
    { id: 'r2', name: '臥室', mat: 'wood', poly: [[3500, 100], [5500, 100], [5500, 2000], [3500, 2000]], at: [4500, 1000] },
  ],
  materials: { wood: { name: '橡木地板', sw: '#d8b88a' }, tile: { name: '磁磚', sw: '#cfd8dc' } },
  furniture: [{ id: 'f1', type: 'sofa', name: '沙發', cx: 1500, cy: 2500, w: 800, d: 600, rot: 0 }], measurements: [], dimensions: [],
};

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-rooms-edit-'))), plan = join(dir, 'plan.json');
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
  const panel = id => page.locator(`[data-room-panel${id ? `="${id}"` : ''}]`);
  const steps = () => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(b => b.textContent.includes('步驟')).map(b => b.textContent));
  const room = (id, p = fileJson()) => p.rooms.find(r => r.id === id);
  const pointField = (index, axis) => page.locator(`[data-room-point="${index}-${axis}"]`);
  const typePoint = async (index, axis, value) => { await pointField(index, axis).fill(String(value)); await pointField(index, axis).press('Enter'); };
  /** The screen position of a plan point. */
  const screen = ([x, y]) => page.evaluate(([px, py]) => { const svg = document.querySelector('svg.plan-svg'), p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM()); return [p.x, p.y]; }, [x, y]);
  const clickPlan = async point => { const [x, y] = await screen(point); await page.mouse.move(x, y); await page.mouse.click(x, y); };
  const undo = () => page.keyboard.press('ControlOrMeta+z');
  /** The outline of a room on the drawing (not the file). */
  const drawn = id => page.locator(`polygon[data-room-id="${id}"]`).evaluate(p => p.getAttribute('points').split(' ').map(q => q.split(',').map(Number)));
  /** A mouse drag from one plan point to another; `during` runs before the button goes up. */
  async function drag(from, to, during = async () => {}, modifier = null) {
    const [x0, y0] = await screen(from), [x1, y1] = await screen(to);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2); await page.mouse.move(x1, y1);
    await during(); await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
  }
  const name = () => page.locator('header input').first().inputValue();

  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');
  const mmPerPx = 1000 / ((await screen([1000, 0]))[0] - (await screen([0, 0]))[0]);
  check('setup: the snap distance of 8 px is more than 30 mm at this zoom', 8 * mmPerPx > 30, `${mmPerPx.toFixed(2)} mm per px`);

  // 1. Selection shows a handle with a number on each point; the panel lists the same points.
  await clickPlan([600, 2500]);
  check('select: the room panel shows, with one numbered handle for each point', (await panel('r1').count()) === 1 && (await page.locator('[data-room-handle]').evaluateAll(h => h.map(x => x.textContent).join(''))) === '1234' && (await page.locator('[data-room-point-row]').count()) === 4);
  check('panel: the wall area uses the ceiling height of the plan', (await panel('r1').innerText()).includes('層高 3.0 m'));
  check('no write so far', same(fileJson(), start));

  // 2. Drag a point: a local preview, and one command at pointer up. The label of the room does not move.
  let mid = null, midFile = null;
  await drag([3000, 3000], [3404, 3504], async () => { await sleep(600); mid = await drawn('r1'); midFile = fileJson(); });
  check('drag: the preview moves the point on the drawing and writes nothing', same(mid[2], [3400, 3500]) && same(midFile, start), JSON.stringify(mid));
  check('drag: at pointer up the point is in the file, on the 10 mm grid; the other points and the label are the same', (await until(() => same(room('r1').poly, [[100, 100], [3000, 100], [3400, 3500], [100, 3000]]))) >= 0 && same(room('r1').at, [1500, 1500]), JSON.stringify(room('r1')));
  check('drag: one undo step with its label, and the room stays selected', same(await steps(), ['步驟 1 前 · 調整空間外框']) && (await panel('r1').count()) === 1, (await steps()).join(' | '));
  await undo();
  check('undo: the plan from before the drag, exactly', (await until(() => same(fileJson(), start))) >= 0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  check('redo: the point is at the new place again', (await until(() => same(room('r1').poly[2], [3400, 3500]))) >= 0);
  await undo(); await until(() => same(fileJson(), start));

  // 3. Snap: a point of another room, the line of an adjacent point, a wall face; Alt gives the grid only.
  await drag([3000, 100], [3520, 125]);
  check('snap: a point near a point of another room goes to that point', (await until(() => same(room('r1').poly[1], [3500, 100]))) >= 0, JSON.stringify(room('r1').poly));
  await undo(); await until(() => same(fileJson(), start));
  await drag([3000, 100], [3520, 125], async () => {}, 'Alt');
  check('snap: with Alt the point goes to the 10 mm grid only', (await until(() => same(room('r1').poly[1], [3520, 130]) || same(room('r1').poly[1], [3520, 120]))) >= 0, JSON.stringify(room('r1').poly));
  await undo(); await until(() => same(fileJson(), start));
  await drag([3000, 3000], [3415, 3020]);
  check('snap: a point near the line of the adjacent point stays on that line (the edge stays horizontal)', (await until(() => room('r1').poly[2][0] !== 3000)) >= 0 && room('r1').poly[2][1] === 3000 && room('r1').poly[2][0] % 10 === 0, JSON.stringify(room('r1').poly));
  await undo(); await until(() => same(fileJson(), start));
  await drag([100, 3000], [125, 3600]);
  check('snap: a point near a wall face goes to the face', (await until(() => same(room('r1').poly[3], [100, 3600]))) >= 0, JSON.stringify(room('r1').poly));
  await undo(); await until(() => same(fileJson(), start));

  // 4. A refused outline goes back, with the reason. Escape, undo during a drag and a click are no edit.
  await drag([100, 100], [2500, 3600]); await sleep(600);
  check('refused: an outline that crosses itself changes nothing, the drawing goes back, and the reason shows', same(fileJson(), start) && same(await drawn('r1'), start.rooms[0].poly) && (await editNotice('error').innerText()).includes('外框：外框的邊互相交叉') && (await steps()).length === 0, (await editNotice().innerText().catch(() => '')).replace(/\n/g, ' / '));
  await page.locator('[data-edit-notice-close]').click();
  await drag([3000, 3000], [3400, 3500], async () => { await page.keyboard.press('Escape'); await sleep(100); mid = await drawn('r1'); });
  await sleep(600);
  check('drag: Escape drops the drag, the drawing goes back, and nothing is written', same(mid, start.rooms[0].poly) && same(fileJson(), start) && (await steps()).length === 0);
  await clickPlan([600, 2500]);
  await drag([3000, 3000], [3400, 3500]); await until(() => same(room('r1').poly[2], [3400, 3500]));
  await drag([3400, 3500], [3800, 3800], async () => { await undo(); await sleep(100); });
  await sleep(600);
  check('drag: undo during a drag works, drops the drag, and the pointer up adds no step', same(fileJson(), start) && (await steps()).length === 0 && same(await drawn('r1'), start.rooms[0].poly));
  await clickPlan([3000, 3000]); await sleep(600);
  check('click: a click on a handle with no movement is no edit', same(fileJson(), start) && (await steps()).length === 0 && (await panel('r1').count()) === 1);

  // 5. Touch: a drag of a handle; a cancelled pointer and a second finger drop the drag.
  const svgEvent = (type, point, init) => page.locator('svg.plan-svg').dispatchEvent(type, { bubbles: true, cancelable: true, button: 0, isPrimary: true, clientX: point[0], clientY: point[1], pointerType: 'touch', ...init });
  const handleEvent = (index, type, point, init) => page.locator(`[data-room-handle="${index}"]`).dispatchEvent(type, { bubbles: true, cancelable: true, button: 0, isPrimary: true, clientX: point[0], clientY: point[1], pointerType: 'touch', ...init });
  { const p = await screen([3000, 3000]), q = await screen([3400, 3500]);
    await handleEvent(2, 'pointerdown', p, { pointerId: 31 }); await svgEvent('pointermove', q, { pointerId: 31 });
    check('touch: a drag of a handle shows the preview and writes nothing', same((await drawn('r1'))[2], [3400, 3500]) && same(fileJson(), start));
    await svgEvent('pointerup', q, { pointerId: 31 }); }
  check('touch: at finger up the point is in the file', (await until(() => same(room('r1').poly[2], [3400, 3500]))) >= 0);
  const afterTouch = fileText(), stepsAfterTouch = (await steps()).length;
  { const p = await screen([3400, 3500]), q = await screen([3800, 3800]);
    await handleEvent(2, 'pointerdown', p, { pointerId: 32 }); await svgEvent('pointermove', q, { pointerId: 32 }); await svgEvent('pointercancel', q, { pointerId: 32 }); }
  await sleep(600);
  check('touch: a cancelled pointer drops the drag', same((await drawn('r1'))[2], [3400, 3500]) && fileText() === afterTouch && (await steps()).length === stepsAfterTouch);
  { const p = await screen([3400, 3500]), q = await screen([3800, 3800]), other = await screen([1000, 3800]);
    await handleEvent(2, 'pointerdown', p, { pointerId: 33 }); await svgEvent('pointermove', q, { pointerId: 33 });
    await svgEvent('pointerdown', other, { pointerId: 34, isPrimary: false });
    const during = (await drawn('r1'))[2];
    await svgEvent('pointerup', other, { pointerId: 34, isPrimary: false }); await svgEvent('pointerup', q, { pointerId: 33 });
    await sleep(600);
    check('touch: a second finger (pinch) drops the drag, and nothing is written', same(during, [3400, 3500]) && fileText() === afterTouch && (await steps()).length === stepsAfterTouch, JSON.stringify(during)); }

  // 6. A change from outside during a drag is a conflict; after a drag the editor is not busy.
  { const [x0, y0] = await screen([3400, 3500]), [x1, y1] = await screen([3600, 3600]);
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1);
    apply([{ op: 'set_plan_name', name: 'Agent during the drag' }]);
    check('conflict: a change from outside during a drag shows the message', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
    await until(async () => (await name()) === 'Agent during the drag');
    check('conflict: the file version loads, with the outline that the file has', same(room('r1').poly[2], [3400, 3500]) && same(await drawn('r1'), room('r1').poly) && (await notice('conflict').count()) === 0); }
  await clickPlan([600, 2500]);
  apply([{ op: 'set_plan_name', name: 'Agent after the drag' }]);
  check('after a drag the editor is not busy: a change from outside loads', (await until(async () => (await name()) === 'Agent after the drag')) >= 0 && (await notice('conflict').count()) === 0);

  // 7. The panel: typed coordinates, insert and delete a point. This is the path with no gesture.
  await clickPlan([600, 2500]);
  await typePoint(2, 'x', 3000); await until(() => room('r1').poly[2][0] === 3000);
  await typePoint(2, 'y', 3000);
  check('panel: typed X and Y move the point, each as one step', (await until(() => same(room('r1').poly, start.rooms[0].poly))) >= 0 && (await steps()).length === 2 && (await steps()).at(0).includes('調整空間外框'), (await steps()).join(' | '));
  await page.locator('[data-room-point-insert="1"]').click();
  check('panel: insert adds a point at the middle of the edge, and the drawing has a handle for it', (await until(() => same(room('r1').poly, [[100, 100], [3000, 100], [3000, 1550], [3000, 3000], [100, 3000]]))) >= 0 && (await page.locator('[data-room-handle]').count()) === 5, JSON.stringify(room('r1').poly));
  await drag([3000, 1550], [3604, 1554]);
  check('panel: the new point can be dragged', (await until(() => same(room('r1').poly[2], [3600, 1550]))) >= 0, JSON.stringify(room('r1').poly));
  await typePoint(2, 'x', 'abc'); await sleep(300);
  check('panel: a value that is not a number changes nothing, and the field shows the value of the plan', (await pointField(2, 'x').inputValue()) === '3600' && same(room('r1').poly[2], [3600, 1550]));
  await page.getByLabel('顯示單位').selectOption('cm');
  check('panel: the fields follow the display unit', (await pointField(2, 'x').inputValue()) === '360');
  await typePoint(2, 'x', 350);
  check('panel: a value typed in cm is stored in mm', (await until(() => same(room('r1').poly[2], [3500, 1550]))) >= 0);
  await page.getByLabel('顯示單位').selectOption('mm');
  await page.locator('[data-room-point-delete="2"]').click();
  check('panel: delete removes the point', (await until(() => same(room('r1').poly, start.rooms[0].poly))) >= 0 && (await page.locator('[data-room-handle]').count()) === 4);
  await page.locator('[data-room-point-delete="0"]').click(); await until(() => room('r1').poly.length === 3);
  check('panel: a room with 3 points has no delete action', (await page.locator('[data-room-point-delete]').evaluateAll(b => b.every(x => x.disabled))) && (await page.locator('[data-room-point-delete]').count()) === 3);
  await undo(); await until(() => room('r1').poly.length === 4);

  // 8. Name, floor material and "counted in the area" go through the core commands.
  await panel('r1').locator('input[maxlength="80"]').fill('大客廳'); await panel('r1').locator('input[maxlength="80"]').press('Enter');
  check('name: the new name is in the file, with its label', (await until(() => room('r1').name === '大客廳')) >= 0 && (await steps()).at(0).includes('重新命名空間'));
  await panel('r1').getByRole('button', { name: '磁磚' }).click();
  check('material: the new material is in the file, with its label', (await until(() => room('r1').mat === 'tile')) >= 0 && (await steps()).at(0).includes('地板材質'), (await steps()).at(0));
  await page.locator('[data-room-counted]').uncheck();
  check('counted: the room is not counted in the area', (await until(() => room('r1').counted === false)) >= 0);
  await page.locator('[data-room-counted]').check(); await until(() => room('r1').counted === true);

  // 9. Add a room with taps on the drawing. Nothing is written before the end; the first point is not added again.
  const rooms = () => fileJson().rooms.length, draftCount = () => page.locator('[data-room-draft-point]').count();
  const tool = () => page.getByRole('button', { name: '新增空間' }).first().click();
  const newest = () => fileJson().rooms.at(-1);
  let before = rooms();
  await tool();
  check('add: the tool shows its panel, and the handles of the selected room are hidden', (await page.locator('[data-add-room-panel]').count()) === 1 && (await page.locator('[data-room-handle]').count()) === 0);
  for (const p of [[3600, 2400], [5404, 2403], [5400, 3800]]) await clickPlan(p);
  check('add: three taps are three points (on the grid, in line with the point before), and nothing is written', (await draftCount()) === 3 && rooms() === before && (await page.locator('[data-add-room-count]').innerText()).includes('3 個點') && (await page.locator('[data-add-room-points]').innerText()).includes('X 5400，Y 2400'), await page.locator('[data-add-room-points]').innerText());
  await clickPlan([5400, 3800]);
  check('add: a second tap on the same point adds no point', (await draftCount()) === 3);
  await page.locator('[data-add-room-remove]').click();
  check('add: 移除上一點 removes the last point', (await draftCount()) === 2 && await page.locator('[data-add-room-finish]').isDisabled());
  await clickPlan([3600, 2400]);
  check('add: a tap on the first point with fewer than 3 points does nothing', (await draftCount()) === 2 && rooms() === before);
  await clickPlan([5400, 3800]); await clickPlan([3600, 3800]);
  await clickPlan([3610, 2410]);                                              // near the first point: it closes the outline
  check('add: a tap on the first point ends the outline, and that point is not added again', (await until(() => rooms() === before + 1)) >= 0 && same(newest().poly, [[3600, 2400], [5400, 2400], [5400, 3800], [3600, 3800]]), JSON.stringify(newest()));
  check('add: the room has the default name, the first material and a label inside its outline', newest().name === '新空間' && newest().mat === 'wood' && same(newest().at, [4500, 3100]));
  check('add: one undo step with its label; the new room is selected with the select tool', (await steps()).at(0).includes('新增空間') && (await panel(newest().id).count()) === 1 && (await page.locator('[data-room-handle]').count()) === 4 && (await page.getByRole('button', { name: '選取物件' }).first().getAttribute('aria-pressed')) === 'true');
  const withFirst = fileJson();
  await undo();
  check('undo: the room is gone, exactly', (await until(() => rooms() === before)) >= 0);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await until(() => same(fileJson(), withFirst));

  // 10. Enter and 完成 end the outline; Enter in a text field does not.
  before = rooms();
  await tool();
  for (const p of [[600, 3200], [2500, 3200], [2500, 3800]]) await clickPlan(p);
  await page.locator('[data-add-room="x"]').fill('12'); await page.locator('[data-add-room="x"]').press('Enter'); await sleep(500);
  check('add: Enter in a text field does not end the outline', rooms() === before && (await draftCount()) === 3);
  await page.locator('[data-add-room="x"]').fill(''); await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  check('add: Enter ends the outline', (await until(() => rooms() === before + 1)) >= 0 && same(newest().poly, [[600, 3200], [2500, 3200], [2500, 3800]]));
  await undo(); await until(() => rooms() === before);
  await tool();
  for (const p of [[600, 3200], [2500, 3200], [2500, 3800]]) await clickPlan(p);
  await page.locator('[data-add-room-finish]').click();
  check('add: 完成 ends the outline', (await until(() => rooms() === before + 1)) >= 0);
  await undo(); await until(() => rooms() === before);

  // 10b. The usual flow with real clicks: the focus stays on the tool button, and Enter still ends the outline.
  await tool();
  for (const p of [[600, 3200], [2500, 3200], [2500, 3800]]) await clickPlan(p);
  check('add: after real clicks the focus is on the tool button', await page.evaluate(() => document.activeElement?.getAttribute('data-tool') === 'room'));
  await page.keyboard.press('Enter');
  check('add: Enter ends the outline when the focus is on the tool button', (await until(() => rooms() === before + 1)) >= 0 && same(newest().poly, [[600, 3200], [2500, 3200], [2500, 3800]]) && (await page.getByRole('button', { name: '選取物件' }).first().getAttribute('aria-pressed')) === 'true');
  await undo(); await until(() => rooms() === before);
  await tool(); await clickPlan([600, 3200]); await clickPlan([2500, 3200]);
  await clickPlan([2500, 3800]);
  await page.getByRole('button', { name: '顯示整張平面圖' }).first().focus();
  await page.keyboard.press('Enter'); await sleep(500);
  check('add: Enter on another focused button keeps its own action, and does not end the outline', rooms() === before && (await draftCount()) === 3);
  await page.getByRole('button', { name: '選取物件' }).first().click(); await until(async () => (await page.locator('[data-room-draft]').count()) === 0);
  // The first point is 30 mm from a wall face (placed with Alt, so it is not on the face). A tap beside it closes the
  // outline: the face, which is nearer on the X axis, does not take the tap.
  await tool();
  await page.keyboard.down('Alt'); await clickPlan([130, 3300]); await page.keyboard.up('Alt');
  await clickPlan([2000, 3300]); await clickPlan([2000, 3700]);
  await clickPlan([110, 3304]);
  check('add: a tap near the first point closes the outline, also when a wall face is nearer', (await until(() => rooms() === before + 1)) >= 0 && same(newest().poly, [[130, 3300], [2000, 3300], [2000, 3700]]), `${await draftCount()} draft points, ${JSON.stringify(newest().poly)}`);
  await undo(); await until(() => rooms() === before);

  // 11. A refused outline keeps its draft for repair.
  await tool();
  for (const p of [[600, 3200], [2500, 3800], [2500, 3200], [600, 3800]]) await clickPlan(p);
  await page.locator('[data-add-room-finish]').click(); await sleep(600);
  check('add: an outline that crosses itself is refused, and the points stay for repair', rooms() === before && (await draftCount()) === 4 && (await editNotice('error').innerText()).includes('外框的邊互相交叉') && (await page.locator('[data-add-room-panel]').count()) === 1);
  await page.locator('[data-add-room-remove]').click();
  await page.locator('[data-add-room-finish]').click();
  check('add: after the repair the room is added, and the refusal message is gone', (await until(() => rooms() === before + 1)) >= 0 && (await editNotice('error').count()) === 0);
  await undo(); await until(() => rooms() === before);

  // 12. The draft is dropped by Escape, 取消, a tool change, a restore from the history, and a pinch adds no point.
  const draftGone = async () => (await page.locator('[data-room-draft]').count()) === 0;
  await tool(); await clickPlan([600, 3200]); await clickPlan([2500, 3200]);
  await page.keyboard.press('Escape');
  check('draft: Escape drops it', await draftGone() && rooms() === before);
  await clickPlan([600, 3200]); await clickPlan([2500, 3200]);
  await page.locator('[data-add-room-cancel]').click();
  check('draft: 取消 drops it', await draftGone());
  await clickPlan([600, 3200]); await clickPlan([2500, 3200]);
  await page.getByRole('button', { name: '選取物件' }).first().click();
  // The tool change drops the draft in an effect, a moment after the click.
  check('draft: a tool change drops it', (await until(draftGone, 1000)) >= 0 && rooms() === before);
  await tool();
  const tap = async (planPoint, init = { pointerId: 41 }) => { const p = await screen(planPoint); await svgEvent('pointerdown', p, init); await svgEvent('pointerup', p, init); };
  await tap([600, 3200]); await tap([2500, 3200]);
  check('touch: each tap places a point', (await draftCount()) === 2);
  { const p = await screen([2500, 3800]), q = await screen([1500, 3500]);
    await svgEvent('pointerdown', p, { pointerId: 42 }); await svgEvent('pointerdown', q, { pointerId: 43, isPrimary: false });
    await svgEvent('pointerup', q, { pointerId: 43, isPrimary: false }); await svgEvent('pointerup', p, { pointerId: 42 }); }
  await sleep(400);
  check('touch: a pinch adds no point, drops the draft, and writes nothing', await draftGone() && rooms() === before);
  await tap([600, 3200]); await tap([2500, 3200]);
  await page.getByRole('tab', { name: '歷史紀錄' }).first().click();
  const stepsNow = (await steps()).length;
  await page.locator('#history-content button').filter({ hasText: '步驟' }).first().click();
  check('draft: a restore from the history drops it', (await until(async () => (await steps()).length !== stepsNow)) >= 0 && await draftGone());
  await undo(); await sleep(600);
  // The properties panel is hidden now (the history tab is open). A draft that is dropped there leaves the editor free.
  await tap([600, 3200]); await tap([2500, 3200]);
  check('hidden panel: the draft is on the drawing while another tab is open', (await draftCount()) === 2);
  apply([{ op: 'set_plan_name', name: 'Agent during the draft' }]);
  check('hidden panel: a change from outside during the draft is a conflict', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
  await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
  await until(async () => (await name()) === 'Agent during the draft');
  check('hidden panel: the file version loads, and the draft is dropped', await draftGone());
  await tap([600, 3200]); await tap([2500, 3200]);
  await page.keyboard.press('Escape'); await sleep(300);
  apply([{ op: 'set_plan_name', name: 'Agent after the draft' }]);
  check('hidden panel: after Escape the editor is not busy (a change from outside loads, with no conflict)', await draftGone() && (await until(async () => (await name()) === 'Agent after the draft')) >= 0 && (await notice('conflict').count()) === 0);
  await page.getByRole('tab', { name: '物件屬性' }).first().click();

  // 13. A rectangle from typed values. A refused rectangle keeps its values; a unit change starts the form again.
  before = rooms();
  await tool();
  const rect = async values => { for (const [key, value] of Object.entries(values)) await page.locator(`[data-add-room="${key}"]`).fill(String(value)); };
  await rect({ x: 600, y: 3200, width: 50, depth: 50 });
  await page.locator('[data-add-room-submit]').click(); await sleep(600);
  check('rectangle: a room that is too small is refused, and the typed values stay', rooms() === before && (await page.locator('[data-add-room="width"]').inputValue()) === '50' && (await editNotice('error').count()) === 1, (await editNotice().innerText().catch(() => '')).replace(/\n/g, ' / '));
  await page.getByLabel('顯示單位').selectOption('cm');
  check('rectangle: a change of the display unit starts the form again, so no value gets a new meaning', (await page.locator('[data-add-room="width"]').inputValue()) === '' && await page.locator('[data-add-room-submit]').isDisabled());
  await rect({ x: 60, y: 320, width: 150, depth: 60 });
  await page.locator('[data-add-room-submit]').click();
  check('rectangle: typed in cm, the room is in the file in mm, and it is selected', (await until(() => rooms() === before + 1)) >= 0 && same(newest().poly, [[600, 3200], [2100, 3200], [2100, 3800], [600, 3800]]) && (await panel(newest().id).count()) === 1, JSON.stringify(newest()));
  await page.getByLabel('顯示單位').selectOption('mm');
  await tool();
  await rect({ x: 600, y: 3200, width: 'abc', depth: 1000 });
  check('rectangle: no width, no action', await page.locator('[data-add-room-submit]').isDisabled());
  await page.getByRole('button', { name: '選取物件' }).first().click();

  // 14. Delete a room: the furniture in it stays; one undo brings the room back.
  await clickPlan([600, 2500]);
  const beforeDelete = fileJson();
  await page.locator('[data-room-delete]').click();
  check('delete: the room is not in the file, its furniture stays, and the panel closes', (await until(() => !room('r1'))) >= 0 && fileJson().furniture.length === 1 && (await panel().count()) === 0 && (await steps()).at(0).includes('刪除空間'));
  await undo();
  check('undo: the room is back, exactly', (await until(() => same(fileJson(), beforeDelete))) >= 0);

  // 15. A plan with no material: the first room adds the default material in the same undo step.
  await sleep(500);
  const bare = { ...fileJson(), name: 'No material', rooms: [], materials: {} };
  writeFileSync(plan, JSON.stringify(bare, null, 2));
  check('no material: the plan from outside loads', (await until(async () => (await name()) === 'No material')) >= 0);
  await tool();
  await rect({ x: 1000, y: 1000, width: 2000, depth: 2000 });
  await page.locator('[data-add-room-submit]').click();
  check('no material: the room and a default material are in the file', (await until(() => rooms() === 1)) >= 0 && same(Object.keys(fileJson().materials), [newest().mat]) && fileJson().materials[newest().mat].price === undefined, JSON.stringify(fileJson().materials));
  check('no material: one undo step', (await steps()).length === 1);
  await undo();
  check('no material: undo removes the room and the material', (await until(() => rooms() === 0 && same(fileJson().materials, {}))) >= 0);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await until(() => rooms() === 1);

  // 16. The 3D view on the edited plan.
  await page.getByRole('button', { name: '3D 檢視' }).first().click();
  await page.waitForSelector('[aria-label="3D floor-plan view"] canvas'); await sleep(1500);
  check('3D: the view opens on the edited plan', (await page.locator('[aria-label="3D floor-plan view"] canvas').count()) === 1);
  check('the edited plan is valid for the CLI', cli('validate', 'plan.json').status === 0);

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

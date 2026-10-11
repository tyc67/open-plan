// Browser check for roadmap D4b: opening editing through the core commands, in local file mode against a real `serve`.
// Usage: pnpm --filter open-plan-cli build && node tools/checks/openings-edit.mjs   Exit code 0 means every check passed.
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

// A plan with a door and a window in one wall, a wall with the opposite direction, a low wall with a hole, a wall
// that is too short for a door, a demolished wall with a door, and a wall that a hole fills completely.
const start = {
  schemaVersion: 2, id: 'openings-check', name: 'Openings check', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
  walls: [
    { id: 'w1', type: 'n', a: [0, 0], b: [6000, 0], thickness: 200 },
    { id: 'rev', type: 'n', a: [6000, 3000], b: [0, 3000], thickness: 120 },
    { id: 'low', type: 'low', a: [0, 5000], b: [6000, 5000], thickness: 120 },
    { id: 'short', type: 'n', a: [0, 7000], b: [700, 7000], thickness: 120 },
    { id: 'gone', type: 'n', a: [3000, 7000], b: [6000, 7000], thickness: 120, demolished: true },
    { id: 'full', type: 'n', a: [8000, 0], b: [8900, 0], thickness: 120 },
  ],
  openings: [
    { id: 'd1', type: 'door', wallId: 'w1', offset: 1000, width: 900, hinge: 'start', swing: 'left', head: 2100 },
    { id: 'win', type: 'window', wallId: 'w1', offset: 3000, width: 1200, sill: 900, head: 2400 },
    { id: 'h1', type: 'hole', wallId: 'low', offset: 500, width: 900, head: 2100 },
    { id: 'dg', type: 'door', wallId: 'gone', offset: 500, width: 900, hinge: 'start', swing: 'left', head: 2100 },
    { id: 'hf', type: 'hole', wallId: 'full', offset: 0, width: 900, head: 2100 },
  ],
  rooms: [], materials: { wood: { name: '橡木地板', sw: '#d8b88a' } },
  furniture: [], measurements: [], dimensions: [],
};

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-openings-edit-'))), plan = join(dir, 'plan.json');
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
  const panel = id => page.locator(`[data-opening-panel${id ? `="${id}"` : ''}]`);
  const wallPanel = id => page.locator(`[data-wall-panel="${id}"]`);
  const field = name => page.locator(`[data-opening-field="${name}"]`);
  const steps = () => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(b => b.textContent.includes('步驟')).map(b => b.textContent));
  const type = async (name, value) => { await field(name).fill(String(value)); await field(name).press('Enter'); };
  const opening = (id, p = fileJson()) => p.openings.find(o => o.id === id);
  /** The screen position of a plan point. */
  const screen = ([x, y]) => page.evaluate(([px, py]) => { const svg = document.querySelector('svg.plan-svg'), p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM()); return [p.x, p.y]; }, [x, y]);
  const clickPlan = async point => { const [x, y] = await screen(point); await page.mouse.move(x, y); await page.mouse.click(x, y); };
  const selectWall = id => page.locator(`[data-wall-line="${id}"]`).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse', isPrimary: true });
  const undo = () => page.keyboard.press('ControlOrMeta+z');
  /** The left edge of the hit area of an opening, in the plan (the drawing, not the file). */
  const drawnX = id => page.locator(`[data-opening-hit="${id}"]`).evaluate(r => Number(r.getAttribute('x')));
  /** A mouse drag from one plan point to another; `during` runs before the button goes up. */
  async function drag(from, to, during = async () => {}) {
    const [x0, y0] = await screen(from), [x1, y1] = await screen(to);
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2); await page.mouse.move(x1, y1);
    await during(); await page.mouse.up();
  }

  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');

  // 1. Selection: a real click on an opening selects the opening, not its wall; the wall is one action away.
  await clickPlan([1450, 0]);
  check('select: a click on a door selects the door, and the ends a and b of its wall are marked', (await panel('d1').count()) === 1 && (await page.locator('[data-wall-end-mark]').evaluateAll(marks => marks.map(m => m.textContent).join(''))) === 'ab');
  check('select: the panel names the wall with its direction and length', (await page.locator('[data-opening-wall]').innerText()).includes('a 在左、b 在右') && (await page.locator('[data-opening-wall]').innerText()).includes('6000 mm'), await page.locator('[data-opening-wall]').innerText());
  await clickPlan([8450, 0]);
  check('select: a click on a wall that a hole fills completely selects the hole', (await panel('hf').count()) === 1);
  await page.locator('[data-opening-select-wall]').click();
  check('select: the action in the panel selects the wall of the opening', (await wallPanel('full').count()) === 1 && (await panel().count()) === 0);
  await page.locator('[data-wall-opening="hf"]').click();
  check('select: the wall panel lists its openings, and an entry selects the opening', (await panel('hf').count()) === 1);
  await clickPlan([5000, 0]);
  check('select: a click on a solid part still selects the wall', (await wallPanel('w1').count()) === 1);
  check('no write so far', same(fileJson(), start));

  // 2. Offset and width: each is one command and one undo step; a refused value changes nothing.
  await clickPlan([1450, 0]);
  await type('offset', 1500);
  check('offset: the new value is in the file', (await until(() => opening('d1').offset === 1500)) >= 0);
  check('offset: one undo step with its label', same(await steps(), ['步驟 1 前 · 移動門窗']), (await steps()).join(' | '));
  await type('width', 800);
  check('width: the edge at a stays by default', (await until(() => opening('d1').width === 800 && opening('d1').offset === 1500)) >= 0);
  await page.locator('[data-opening-keep="end"]').check();
  await type('width', 900);
  check('width: the edge at b stays when it is chosen', (await until(() => opening('d1').width === 900 && opening('d1').offset === 1400)) >= 0, JSON.stringify(opening('d1')));
  const beforeRefusal = fileText(), stepsBefore = (await steps()).length;
  await type('offset', 5500); await sleep(600);
  check('refused: an offset that leaves the wall changes nothing, and the field shows the value of the plan', fileText() === beforeRefusal && (await field('offset').inputValue()) === '1400' && (await steps()).length === stepsBefore);
  check('refused: the reasons show, with the field name and no command path', (await editNotice('error').innerText()).includes('位置：超出牆的長度') && !(await editNotice('error').innerText()).includes('commands['), (await editNotice().innerText().catch(() => '')).replace(/\n/g, ' / '));
  await type('offset', 2500); await sleep(600);
  check('refused: an offset on top of the window changes nothing', fileText() === beforeRefusal && (await editNotice('error').innerText()).includes('重疊'));

  // 3. Heights, hinge and swing.
  await type('head', 2000);
  check('head: the new value is in the file, and the refusal message is gone', (await until(() => opening('d1').head === 2000)) >= 0 && (await editNotice().count()) === 0);
  await type('head', 3500); await sleep(600);
  check('head: a head above the ceiling is refused', opening('d1').head === 2000 && (await editNotice('error').innerText()).includes('頂高：'));
  await field('hinge').selectOption('end'); await field('swing').selectOption('right');
  check('door: the hinge side and the swing are in the file', (await until(() => opening('d1').hinge === 'end' && opening('d1').swing === 'right')) >= 0);
  await clickPlan([3600, 0]);
  check('window: the panel has the sill, and no hinge', (await panel('win').count()) === 1 && (await field('sill').count()) === 1 && (await field('hinge').count()) === 0);
  await type('sill', 1000);
  check('sill: the new value is in the file', (await until(() => opening('win').sill === 1000)) >= 0);
  await type('sill', 2600); await sleep(600);
  check('sill: a sill above the head is refused', opening('win').sill === 1000 && (await editNotice('error').count()) === 1);
  await type('name', '客廳窗');
  check('name: the name is in the file', (await until(() => opening('win').name === '客廳窗')) >= 0);

  // 4. Type: each change sends the fields of the new type; the width and the offset stay.
  const keys = id => Object.keys(opening(id)).sort().join(',');
  for (const [to, expected] of [['sliding-door', 'head,id,name,offset,type,wallId,width'], ['hole', 'head,id,name,offset,type,wallId,width'], ['door', 'head,hinge,id,name,offset,swing,type,wallId,width'], ['window', 'head,id,name,offset,sill,type,wallId,width']]) {
    await field('type').selectOption(to);
    check(`type: to ${to}, with exactly the fields of that type`, (await until(() => opening('win').type === to)) >= 0 && keys('win') === expected && opening('win').offset === 3000 && opening('win').width === 1200, keys('win'));
  }
  check('type: one undo step for each change, with its label', (await steps()).at(0).includes('變更門窗類型'));
  await clickPlan([950, 5000]);
  const beforeLow = fileText();
  await field('type').selectOption('window'); await sleep(600);
  check('type: a window in a low wall is refused, and the selector shows the type of the plan', fileText() === beforeLow && (await field('type').inputValue()) === 'hole' && (await editNotice('error').innerText()).includes('矮牆'), (await editNotice().innerText().catch(() => '')).replace(/\n/g, ' / '));

  // 5. Drag along its own wall: a local preview, and one command at pointer up.
  await clickPlan([3600, 0]);                                                 // select the window (3000 to 4200)
  const beforeDrag = fileJson(), stepsBeforeDrag = (await steps()).length;
  let midX = null, midFile = null;
  await drag([3600, 0], [4104, 0], async () => { await sleep(600); midX = await drawnX('win'); midFile = fileText(); });
  check('drag: the preview moves the opening on the drawing and writes nothing', midX === 3500 && midFile === JSON.stringify(beforeDrag, null, 2) || (midX === 3500 && same(JSON.parse(midFile), beforeDrag)), `drawn at ${midX}`);
  check('drag: at pointer up the new offset is in the file, on the 10 mm grid', (await until(() => opening('win').offset === 3500)) >= 0, JSON.stringify(opening('win')));
  check('drag: one undo step with its label, and the opening stays selected', (await steps()).length === stepsBeforeDrag + 1 && (await steps()).at(0).includes('移動門窗') && (await panel('win').count()) === 1);
  await undo();
  check('undo: the plan from before the drag, exactly', (await until(() => same(fileJson(), beforeDrag))) >= 0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  check('redo: the opening is at the new offset again', (await until(() => opening('win').offset === 3500)) >= 0);
  await drag([4000, 0], [200, 0]);
  check('drag: the opening stops at the opening beside it', (await until(() => opening('win').offset === 2300)) >= 0, JSON.stringify(opening('win')));
  await drag([2900, 0], [9000, 0]);
  check('drag: the opening stops at the end of the wall', (await until(() => opening('win').offset === 4800)) >= 0, JSON.stringify(opening('win')));
  const beforeCancel = fileText(), stepsBeforeCancel = (await steps()).length;
  await drag([5400, 0], [4400, 0], async () => { await page.keyboard.press('Escape'); await sleep(100); midX = await drawnX('win'); });
  await sleep(600);
  check('drag: Escape drops the drag, the drawing goes back, and nothing is written', midX === 4800 && fileText() === beforeCancel && (await steps()).length === stepsBeforeCancel);
  // Undo and redo during a drag drop the drag: the pointer up after them is no edit.
  for (const [keys, name, done] of [['ControlOrMeta+z', 'undo', () => opening('win').offset === 2300], ['ControlOrMeta+Shift+z', 'redo', () => opening('win').offset === 4800]]) {
    const stepsNow = (await steps()).length;
    await drag([5400, 0], [4400, 0], async () => { await page.keyboard.press(keys); await sleep(100); });
    const settled = await until(done); await sleep(600);
    check(`drag: ${name} during a drag works, drops the drag, and the pointer up adds no step`, settled >= 0 && done() && (await steps()).length === stepsNow + (name === 'undo' ? -1 : 1) && (await drawnX('win')) === opening('win').offset, `offset ${opening('win').offset}, drawn at ${await drawnX('win')}`);
    if (name === 'undo') await clickPlan([2900, 0]);                           // the window is at 2300 now: select it there
  }
  await clickPlan([5400, 0]); await clickPlan([5400, 0]); await sleep(600);
  check('click: a click with no movement is no edit', fileText() === beforeCancel && (await steps()).length === stepsBeforeCancel && (await panel('win').count()) === 1);
  await clickPlan([5900, 1500]);                                              // empty canvas: no selection
  check('click: a click on the empty canvas ends the selection', (await panel().count()) === 0);
  await drag([5400, 0], [4400, 0]); await sleep(600);
  check('drag: an opening that is not selected is only selected by the first press', fileText() === beforeCancel && (await panel('win').count()) === 1);

  // 6. Touch: a tap selects; a drag moves the selected opening; a second finger or a cancelled pointer drops the drag.
  const svgEvent = (type, point, init) => page.locator('svg.plan-svg').dispatchEvent(type, { bubbles: true, cancelable: true, button: 0, isPrimary: true, clientX: point[0], clientY: point[1], pointerType: 'touch', ...init });
  const hitEvent = (id, type, point, init) => page.locator(`[data-opening-hit="${id}"]`).dispatchEvent(type, { bubbles: true, cancelable: true, button: 0, isPrimary: true, clientX: point[0], clientY: point[1], pointerType: 'touch', ...init });
  { const p = await screen([1850, 0]); await hitEvent('d1', 'pointerdown', p, { pointerId: 21 });
    check('touch: a finger down does not select', (await panel('win').count()) === 1);
    await svgEvent('pointerup', p, { pointerId: 21 }); }
  check('touch: a tap selects the opening', (await panel('d1').count()) === 1);
  const beforeTouch = fileText();
  { const p = await screen([1850, 0]), q = await screen([1350, 0]);
    await hitEvent('d1', 'pointerdown', p, { pointerId: 22 }); await svgEvent('pointermove', q, { pointerId: 22 });
    check('touch: a drag of the selected opening shows the preview', (await drawnX('d1')) === 900 && fileText() === beforeTouch);
    await svgEvent('pointerup', q, { pointerId: 22 }); }
  check('touch: at finger up the new offset is in the file', (await until(() => opening('d1').offset === 900)) >= 0, JSON.stringify(opening('d1')));
  const afterTouch = fileText(), stepsAfterTouch = (await steps()).length;
  { const p = await screen([1350, 0]), q = await screen([1850, 0]);
    await hitEvent('d1', 'pointerdown', p, { pointerId: 23 }); await svgEvent('pointermove', q, { pointerId: 23 });
    await svgEvent('pointercancel', q, { pointerId: 23 }); }
  await sleep(600);
  check('touch: a cancelled pointer drops the drag', (await drawnX('d1')) === 900 && fileText() === afterTouch && (await steps()).length === stepsAfterTouch);
  { const p = await screen([1350, 0]), q = await screen([1850, 0]), other = await screen([3000, 2000]);
    await hitEvent('d1', 'pointerdown', p, { pointerId: 24 }); await svgEvent('pointermove', q, { pointerId: 24 });
    await svgEvent('pointerdown', other, { pointerId: 25, isPrimary: false });
    const during = await drawnX('d1');
    await svgEvent('pointerup', other, { pointerId: 25, isPrimary: false }); await svgEvent('pointerup', q, { pointerId: 24 });
    await sleep(600);
    check('touch: a second finger (pinch) drops the drag, and nothing is written', during === 900 && (await drawnX('d1')) === 900 && fileText() === afterTouch && (await steps()).length === stepsAfterTouch, `drawn at ${during}`); }

  // 7. A change from outside during a drag is a conflict, not a silent load.
  { const [x0, y0] = await screen([1350, 0]), [x1, y1] = await screen([1600, 0]);
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1);
    apply([{ op: 'set_plan_name', name: 'Agent during the drag' }]);
    check('conflict: a change from outside during a drag shows the message', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
    await until(async () => (await page.locator('header input').first().inputValue()) === 'Agent during the drag');
    check('conflict: the file version loads, with the opening where the file has it', opening('d1').offset === 900 && (await notice('conflict').count()) === 0); }
  await clickPlan([1350, 0]);
  apply([{ op: 'set_plan_name', name: 'Agent after the drag' }]);
  check('after a drag the editor is not busy: a change from outside loads', (await until(async () => (await page.locator('header input').first().inputValue()) === 'Agent after the drag')) >= 0 && (await notice('conflict').count()) === 0);

  // 8. Move to another wall: the wall and the offset are chosen; nothing is placed automatically.
  await clickPlan([1350, 0]);
  const doorBefore = opening('d1');
  await field('wall').selectOption('rev');
  check('other wall: choosing the wall moves nothing; the offset field starts with the offset of the opening', (await field('wall-offset').inputValue()) === '900' && same(opening('d1'), doorBefore));
  check('other wall: the list names the direction and the length of each wall', (await field('wall').locator('option[value="rev"]').innerText()).includes('a 在右、b 在左') && (await field('wall').locator('option[value="gone"]').count()) === 0);
  await field('wall-offset').fill('5500'); await page.locator('[data-opening-move-wall]').click(); await sleep(600);
  check('other wall: an offset that does not fit is refused, and the opening stays', same(opening('d1'), doorBefore) && (await editNotice('error').innerText()).includes('所在牆：超出牆的長度'), (await editNotice().innerText().catch(() => '')).replace(/\n/g, ' / '));
  // The display unit changes while the form is open: the typed value keeps the unit that the field shows.
  await field('wall-offset').fill('900');
  await page.getByLabel('顯示單位').selectOption('cm'); await sleep(200);
  check('other wall: after a change of the display unit, the field keeps its value and its unit', (await field('wall-offset').inputValue()) === '900' && (await field('wall-offset').locator('xpath=..').innerText()).includes('（mm）') && (await field('offset').inputValue()) === '90');
  await page.locator('[data-opening-move-wall]').click();
  await until(() => opening('d1').wallId === 'rev');
  await page.getByLabel('顯示單位').selectOption('mm');
  check('other wall: the door is in the wall with the opposite direction, with the same offset, hinge and swing', (await until(() => opening('d1').wallId === 'rev')) >= 0 && same(opening('d1'), { ...doorBefore, wallId: 'rev' }));
  check('other wall: the door is drawn 900 mm from end a, which is the right end of that wall', (await drawnX('d1')) === 4200 && (await page.locator('[data-opening-wall]').innerText()).includes('a 在右、b 在左'), `drawn at ${await drawnX('d1')}`);
  check('other wall: one undo step with its label', (await steps()).at(0).includes('移動門窗到另一面牆'));

  // 9. Add an opening from the wall panel, for each type; a wall that is too short is refused.
  for (const [kind, width, wallId] of [['window', 1200, 'rev'], ['sliding-door', 1600, 'rev'], ['hole', 900, 'rev'], ['door', 900, 'low']]) {
    const before = fileJson().openings.length;
    await selectWall(wallId);
    await page.locator('[data-wall-add-opening-type]').selectOption(kind);
    await page.locator('[data-wall-add-opening]').click();
    await until(() => fileJson().openings.length === before + 1);
    const added = fileJson().openings.at(-1);
    check(`add: a ${kind} with the default width is in the wall, clear of the other openings, and it is selected`, added.type === kind && added.wallId === wallId && added.width === width && (await panel(added.id).count()) === 1 && cli('validate', 'plan.json').status === 0, JSON.stringify(added));
  }
  check('add: a new door has a hinge side and a swing', ['start', 'end'].includes(fileJson().openings.at(-1).hinge) && ['left', 'right'].includes(fileJson().openings.at(-1).swing));
  check('add: one undo step with its label', (await steps()).at(0).includes('新增門窗'));
  for (const [wallId, why] of [['short', 'a wall that is shorter than the default width'], ['rev', 'a wall with no free part long enough']]) {
    await selectWall(wallId);
    const before = fileText(), stepsNow = (await steps()).length;
    await page.locator('[data-wall-add-opening-type]').selectOption('door');
    await page.locator('[data-wall-add-opening]').click(); await sleep(600);
    check(`add: ${why} gets no opening, with a reason that names the width`, fileText() === before && (await steps()).length === stepsNow && (await editNotice('error').innerText()).includes('沒有 900 mm 的空位') && (await wallPanel(wallId).count()) === 1, (await editNotice().innerText().catch(() => '')).replace(/\n/g, ' / '));
  }
  await selectWall('low');
  const beforeLowWindow = fileText();
  await page.locator('[data-wall-add-opening-type]').selectOption('window');
  await page.locator('[data-wall-add-opening]').click(); await sleep(600);
  check('add: a window in a low wall is refused by the core, with its reason', fileText() === beforeLowWindow && (await editNotice('error').innerText()).includes('矮牆'));

  // 10. An opening in a demolished wall is not drawn; it is selected from the wall panel, and can be repaired.
  check('demolished wall: its opening is not on the drawing', (await page.locator('[data-opening-hit="dg"]').count()) === 0);
  await selectWall('gone');
  await page.locator('[data-wall-opening="dg"]').click();
  check('demolished wall: the opening is selected from the wall panel, with a note', (await panel('dg').count()) === 1 && (await page.locator('[data-opening-demolished]').count()) === 1);
  const beforeGone = fileText();
  await type('offset', 800); await sleep(600);
  check('demolished wall: a move in the wall is refused', fileText() === beforeGone && (await editNotice('error').innerText()).includes('已標記拆除'));
  await type('name', '舊門');
  check('demolished wall: a new name is accepted', (await until(() => opening('dg').name === '舊門')) >= 0);
  await page.locator('[data-opening-delete]').click();
  check('demolished wall: delete is accepted, and the panel closes', (await until(() => !opening('dg'))) >= 0 && (await panel().count()) === 0);

  // 11. Delete, and undo.
  await clickPlan([5400, 0]);
  const beforeDelete = fileJson();
  await page.locator('[data-opening-delete]').click();
  check('delete: the opening is not in the file, and the wall is solid there', (await until(() => !opening('win'))) >= 0 && (await page.locator('[data-opening-hit="win"]').count()) === 0 && (await steps()).at(0).includes('刪除門窗'));
  await undo();
  check('undo: the opening is back, exactly', (await until(() => same(fileJson(), beforeDelete))) >= 0);

  // 12. The 3D view on the edited plan.
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

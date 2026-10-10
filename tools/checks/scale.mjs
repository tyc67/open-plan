// Browser check for roadmap D3: plan scaling from a measurement, in local file mode against a real `serve` process.
// Usage: pnpm --filter open-plan-cli build && node tools/checks/scale.mjs   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLI = new URL('../../packages/cli/dist/cli.js', import.meta.url).pathname;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const sha = data => createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-plan-scale-'))), plan = join(dir, 'plan.json');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: dir, encoding: 'utf8' });
cli('new', 'plan.json', '--sample');
const fileText = () => readFileSync(plan, 'utf8'), fileJson = () => JSON.parse(fileText()), revision = () => sha(readFileSync(plan));
const backups = () => existsSync(`${plan}.backups`) ? readdirSync(`${plan}.backups`).sort() : [];
const backupTexts = () => backups().map(name => readFileSync(join(`${plan}.backups`, name), 'utf8'));
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
// The measurement m1 is on an outer wall: 2460 mm. In this check the "real" length is 10% more: 2706 mm.
const M1 = { id: 'm1', a: { x: 2120, y: -120 }, b: { x: 4580, y: -120 } }, MEASURED = 2460, REAL = 2706;
{ const p = fileJson(); p.measurements = [M1]; writeFileSync(plan, JSON.stringify(p, null, 2)); }
if (cli('validate', 'plan.json').status !== 0) throw new Error('The plan of the check is not valid.');
const length = (p, id = 'm1') => { const m = p.measurements.find(x => x.id === id); return m ? Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) : null; };
const item = (p, id) => p.furniture.find(f => f.id === id);

const freePort = () => new Promise(done => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const server = spawn(process.execPath, [CLI, 'serve', 'plan.json', '--no-open', '--json', '--port', String(await freePort())], { cwd: dir });
const started = await new Promise((done, fail) => { server.stdout.once('data', d => done(JSON.parse(String(d)))); server.once('exit', code => fail(new Error(`serve ended with ${code}`))); });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const notice = kind => page.locator(`[data-file-notice="${kind}"]`);
  const panel = () => page.locator('[data-measurement-panel]'), form = () => page.locator('[data-scale-form]');
  const distance = () => page.locator('[data-scale-distance]'), applyButton = () => page.locator('[data-scale-apply]');
  const steps = () => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(b => b.textContent.includes('步驟')).map(b => b.textContent));
  const select = (pointerType = 'mouse', id = 'm1') => page.locator(`[data-measurement-id="${id}"] .measurement-hit-area`).dispatchEvent('pointerdown', { button: 0, pointerType, isPrimary: true });
  const open = async () => { await select(); await page.locator('[data-scale-open]').click(); await form().waitFor(); };
  const xField = () => page.locator('.inspector label').filter({ hasText: /^X/ }).locator('input');
  const viewBox = () => page.locator('svg.plan-svg').getAttribute('viewBox');

  await page.goto(started.url); await page.waitForSelector('svg.plan-svg');

  // 1. An ordinary edit first, so the session already has its first-write backup before the scaling.
  await page.locator('[data-furniture-id="sample-f1"]').click(); await xField().fill('8200'); await xField().press('Enter');
  check('setup: an edit before the scaling is in the file, with the first backup of the session', (await until(() => item(fileJson(), 'sample-f1').cx === 8200)) >= 0 && backups().length === 1);
  await page.keyboard.press('Escape');
  const before = fileJson(), beforeText = fileText(), stepsBefore = (await steps()).length, viewBefore = await viewBox();

  // 2. Selection (mouse and touch) shows the measurement panel; the form shows a preview and writes nothing.
  await select('touch');
  check('select: a touch on the measurement shows its panel with the length', (await panel().count()) === 1 && (await page.locator('[data-measured-length]').innerText()) === `${MEASURED} mm`);
  await page.keyboard.press('Escape');
  check('select: Escape clears the selection and the panel', (await panel().count()) === 0);
  await open();
  check('form: the field has the focus and Apply is off without a distance', (await distance().evaluate(el => el === document.activeElement)) && await applyButton().isDisabled());
  await distance().fill('abc');
  check('form: text that is not a number gives a message and no preview', (await form().locator('[role="alert"]').innerText()).includes('大於 0') && (await page.locator('[data-scale-preview]').count()) === 0 && await applyButton().isDisabled());
  await distance().fill(String(REAL));
  check('preview: the factor and the plan size', (await page.locator('[data-scale-factor]').innerText()) === '×1.1000（+10.0%）' && (await page.locator('[data-scale-preview]').innerText()).includes('→'), (await page.locator('[data-scale-preview]').innerText()).replace(/\n/g, ' '));
  check('preview: no warning for a usual factor', (await page.locator('[data-scale-note]').count()) === 0);
  await distance().fill('900');
  check('preview: an unusual factor gives a warning about the unit', (await page.locator('[data-scale-note="unusual-factor"]').count()) === 1);
  await distance().fill(String(MEASURED));
  check('preview: the same length needs no change, and Apply is off', (await form().innerText()).includes('不需要調整') && await applyButton().isDisabled());
  await sleep(700);
  check('preview: nothing is written and no undo step is made', fileText() === beforeText && (await steps()).length === stepsBefore);

  // 3. Cancel: Escape while typing, and the button. The measurement stays selected; the plan does not change.
  await distance().fill(String(REAL)); await distance().press('Escape');
  check('cancel: Escape in the field closes the form and keeps the selection', (await form().count()) === 0 && (await panel().count()) === 1);
  await page.locator('[data-scale-open]').click(); await distance().fill(String(REAL)); await page.locator('[data-scale-cancel]').click();
  await sleep(700);
  check('cancel: the button closes the form; nothing is written', (await form().count()) === 0 && fileText() === beforeText && (await steps()).length === stepsBefore);

  // 4. A result with errors is refused: the errors show, and nothing changes.
  await page.locator('[data-scale-open]').click(); await distance().fill(String(MEASURED * 3));
  check('refused: the errors of the result show and Apply is off', (await page.locator('[data-scale-errors] li').count()) >= 1 && await applyButton().isDisabled(), (await page.locator('[data-scale-errors]').innerText().catch(() => '')).replace(/\n/g, ' / '));
  await distance().press('Enter'); await sleep(700);
  check('refused: Enter changes nothing', fileText() === beforeText && (await steps()).length === stepsBefore && (await form().count()) === 1);

  // 5. Apply (Enter): the plan is scaled through one write with a backup first, as one undo step.
  await distance().fill(String(REAL)); await distance().press('Enter');
  check('apply: the scaled plan is in the file', (await until(() => Math.abs(length(fileJson()) - REAL) <= 1)) >= 0, `measurement ${length(fileJson())} mm`);
  const scaled = fileJson(), scaledText = fileText();
  check('apply: the file was backed up first, also after the earlier write of the session', backups().length === 2 && backupTexts().includes(beforeText));
  check('apply: the furniture keeps its size and turn; its position scales', before.furniture.every(f => { const s = item(scaled, f.id); return s.w === f.w && s.d === f.d && s.rot === f.rot; }) && item(scaled, 'sample-f1').cx !== item(before, 'sample-f1').cx);
  check('apply: the walls scale from the first point of the measurement, with their thickness', scaled.walls.every((w, i) => Math.abs(w.a[0] - (M1.a.x + (before.walls[i].a[0] - M1.a.x) * 1.1)) <= 1 && Math.abs(w.thickness - before.walls[i].thickness * 1.1) <= 1));
  check('apply: the heights do not change', scaled.ceilingHeight === before.ceilingHeight && scaled.openings.every((o, i) => o.head === before.openings[i].head && o.sill === before.openings[i].sill));
  check('apply: the form closes and the panel shows the typed length', (await form().count()) === 0 && (await page.locator('[data-measured-length]').innerText()) === `${REAL} mm`, await page.locator('[data-measured-length]').innerText().catch(() => 'no panel'));
  const after = await steps();
  check('apply: one undo step with its own label', after.length === stepsBefore + 1 && after.some(t => t.includes('調整平面圖比例')), after.join(' | '));
  check('apply: the view fits the scaled plan', (await viewBox()) !== viewBefore);
  check('apply: the scaled plan is valid for the CLI', cli('validate', 'plan.json').status === 0);

  // 6. One undo gives the exact plan from before; redo gives the scaled plan. A plan swap closes an open form.
  await page.locator('[data-scale-open]').click(); await distance().fill('3000'); await page.locator('[data-scale-cancel]').focus();
  await page.keyboard.press('ControlOrMeta+z');
  check('undo: the file has the exact plan from before the scaling', (await until(() => JSON.stringify(fileJson()) === JSON.stringify(before))) >= 0);
  check('undo: an open form closes', (await form().count()) === 0);
  await select(); await page.locator('[data-scale-open]').click(); await page.locator('[data-scale-cancel]').focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  check('redo: the file has the scaled plan again', (await until(() => fileText() === scaledText)) >= 0);
  check('redo: an open form closes', (await form().count()) === 0);
  check('undo and redo: no more backups', backups().length === 2);

  // 7. The display unit cm: the field takes cm, and stays in cm when the unit changes while the form is open.
  const unitSelect = page.locator('select:has(option[value="cm"])').first();
  await unitSelect.selectOption('cm');
  await select(); await page.locator('[data-scale-open]').click();
  await unitSelect.selectOption('mm');
  check('unit: the field keeps the unit from when the form opened', (await form().locator('label').innerText()).includes('cm'));
  await distance().fill('297.66');                                                   // 2976.6 mm: ×1.1 again
  check('unit: a cm value with decimals gives the factor', (await page.locator('[data-scale-factor]').innerText()).startsWith('×1.1000'), await page.locator('[data-scale-factor]').innerText());
  await page.locator('[data-scale-cancel]').click();

  // 7b. The panel stays mounted when another tab is shown or the side panel is closed. A form that the user cannot see
  // closes, so it does not keep the editor busy: a change from outside then loads with no conflict message.
  const rightTab = name => page.getByRole('tab', { name }).first();
  await page.locator('[data-scale-open]').click(); await distance().fill('2900');
  await rightTab('歷史紀錄').click();
  apply([{ op: 'set_plan_name', name: 'Agent with the form hidden' }]);
  check('hidden form: a change from outside loads with no conflict message', (await until(async () => (await page.locator('header input').first().inputValue()) === 'Agent with the form hidden')) >= 0 && (await notice('conflict').count()) === 0);
  await select();
  check('hidden form: the form is closed when the panel shows again', (await panel().count()) === 1 && (await form().count()) === 0);
  await page.locator('[data-scale-open]').click(); await distance().fill('2900');
  await rightTab('物件屬性').click();                                                // the active tab: this closes the side panel
  apply([{ op: 'set_plan_name', name: 'Agent with the panel closed' }]);
  check('closed panel: a change from outside loads with no conflict message', (await until(async () => (await page.locator('header input').first().inputValue()) === 'Agent with the panel closed')) >= 0 && (await notice('conflict').count()) === 0);
  await select();

  // 8. A change from outside while the form is open is a conflict, not a silent load; Apply does not write over it.
  await page.locator('[data-scale-open]').click(); await distance().fill('2900'); await applyButton().focus();
  apply([{ op: 'set_plan_name', name: 'Agent during scaling' }]);
  const externalText = fileText();
  check('conflict: a change from outside while the form is open shows the message', (await until(async () => (await notice('conflict').count()) === 1)) >= 0);
  check('conflict: the form stays open with the typed value', (await form().count()) === 1 && (await distance().inputValue()) === '2900');
  await applyButton().click(); await sleep(900);
  check('conflict: Apply does not write over the file version', fileText() === externalText && fileJson().name === 'Agent during scaling');
  const backupsBefore = backups().length;
  await notice('conflict').getByRole('button', { name: '載入檔案版本' }).click();
  check('conflict: loading the file version shows it and closes the scaling', (await until(async () => (await page.locator('header input').first().inputValue()) === 'Agent during scaling')) >= 0 && (await form().count()) === 0);
  check('conflict: the browser version (scaled again) was backed up', backups().length === backupsBefore + 1 && fileText() === externalText);

  // 9. A locked dimensions layer has no measurement selection, so no scaling; other locked layers do not stop it.
  const lock = async label => { const tab = page.getByRole('tab', { name: '圖層與物件' }).first(); if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click(); await page.getByRole('button', { name: `鎖定${label}` }).first().click(); };
  await lock('家具物件');
  await select(); await page.locator('[data-scale-open]').click();
  const lockedBefore = fileJson();
  await distance().fill(String(REAL + 100)); await distance().press('Enter');
  check('locks: a locked furniture layer does not stop the scaling of the whole plan', (await until(() => Math.abs(length(fileJson()) - (REAL + 100)) <= 1)) >= 0 && item(fileJson(), 'sample-f1').cx !== item(lockedBefore, 'sample-f1').cx);
  await lock('家具物件'); await lock('尺寸與測量');
  await select();
  check('locks: with a locked dimensions layer no measurement can be selected, so there is no scaling', (await panel().count()) === 0);
  await lock('尺寸與測量');

  // 10. A measurement that the user draws is its own undo step, before the scaling step.
  const stepsNow = (await steps()).length;
  await page.keyboard.press('Escape'); await page.keyboard.press('m');
  const box = await page.locator('svg.plan-svg').boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5); await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await until(() => fileJson().measurements.length === 2);
  const drawn = fileJson().measurements.find(m => m.id !== 'm1');
  check('draw: a new measurement is one undo step', !!drawn && (await steps()).length === stepsNow + 1, (await steps()).join(' | '));
  if (drawn) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '選取' }).first().click().catch(() => {});
    await select('mouse', drawn.id); await page.locator('[data-scale-open]').click();
    const real = Math.round(length(fileJson(), drawn.id) * 0.9);
    await distance().fill(String(real)); await distance().press('Enter');
    check('draw: scaling from the drawn measurement gives the typed length', (await until(() => Math.abs(length(fileJson(), drawn.id) - real) <= 1)) >= 0, `${length(fileJson(), drawn.id)} for ${real}`);
    check('draw: the scaling is one more undo step', (await steps()).length === stepsNow + 2);
  }

  // 11. The 3D view shows the scaled plan.
  await page.getByRole('button', { name: '3D 檢視' }).first().click();
  await page.waitForSelector('[aria-label="3D floor-plan view"] canvas'); await sleep(1500);
  check('3D: the view opens on the scaled plan, and the measurement panel is gone', (await panel().count()) === 0);

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

// Browser check for roadmap B2: the saved-plan policy of the shared validator in the editor.
// Usage: node tools/checks/validation.mjs <url> [image-dir]   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePlan } from '../../packages/core/dist/index.js';

const [url, imageDir] = process.argv.slice(2);
if (!url) { console.error('Usage: node tools/checks/validation.mjs <url> [image-dir]'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'open-plan:document:v1', BACKUP = 'open-plan:document:v1:replaced', RECOVERY = 'open-plan:document:v1:recovery';
if (imageDir) await mkdir(imageDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

/** A small saved v2 plan with every height present. */
const base = () => ({
  schemaVersion: 2, id: 'validation-check', name: 'Validation check', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
  walls: [
    { id: 'w1', type: 'e', a: [0, 0], b: [6000, 0], thickness: 200 },
    { id: 'w2', type: 'e', a: [6000, 0], b: [6000, 4000], thickness: 200 },
    { id: 'w3', type: 'low', a: [0, 4000], b: [6000, 4000], thickness: 120 },
    { id: 'w4', type: 'e', a: [0, 0], b: [0, 4000], thickness: 200 },
  ],
  openings: [
    { id: 'win', type: 'window', wallId: 'w1', offset: 800, width: 1500, sill: 900, head: 2400 },
    { id: 'door', type: 'door', wallId: 'w2', offset: 1000, width: 900, hinge: 'start', swing: 'right', head: 2100 },
  ],
  rooms: [{ id: 'r1', name: '房間', mat: 'wood', poly: [[100, 100], [5900, 100], [5900, 3940], [100, 3940]] }],
  materials: { wood: { name: '橡木地板', sw: '#d8b88a' } },
  furniture: [{ id: 'f1', type: 'sofa', name: '沙發', cx: 3000, cy: 2000, w: 2000, d: 900, rot: 0, color: '#9aa5b1' }],
  measurements: [], dimensions: [],
});
const variant = change => { const p = base(); change(p); return p; };

// Every tolerable issue at once (roadmap B2): it must open, draw in 2D and 3D, and keep its data.
const tolerable = variant(p => {
  p.openings.push({ id: 'win2', type: 'window', wallId: 'w1', offset: 2000, width: 1200, sill: -100, head: 2400 });   // overlap, sill < 0
  p.openings[1].head = 3500;                                                                                          // door head above the ceiling
  p.openings.push({ id: 'lowwin', type: 'window', wallId: 'w3', offset: 2000, width: 1000, sill: 600, head: 2000 });  // window in a low wall
  p.rooms.push({ id: 'bow', name: '交叉', mat: 'wood', poly: [[500, 500], [1500, 1500], [1500, 500], [500, 1500]] });
  p.rooms.push({ id: 'tiny', name: '很小', mat: 'wood', poly: [[2000, 2000], [2050, 2000], [2050, 2050], [2000, 2050]] });
  p.rooms.push({ id: 'nomat', name: '無材質', mat: 'granite', poly: [[3000, 3000], [4000, 3000], [4000, 3500], [3000, 3500]] });
  p.furniture.push({ id: 'far', type: 'table', name: '遠處', cx: 120_000, cy: 2000, w: 1200, d: 800, rot: 0, color: '#b08b5a' });
  p.walls[3].demolished = true;                                                                                       // demolished exterior wall
});

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const read = key => page.evaluate(k => localStorage.getItem(k), key);
  const settle = () => page.waitForTimeout(700);
  const load = async (entries) => {
    await page.evaluate(e => { localStorage.clear(); for (const [k, v] of e) localStorage.setItem(k, v); }, entries);
    await page.reload(); await page.waitForSelector('svg.plan-svg'); await settle();
  };
  const openPanel = () => page.getByRole('button', { name: 'Open Plan 專案設定' }).click();
  const listed = selector => page.locator(`${selector} li`).allInnerTexts();
  const shot3d = async plan => {
    await load([[KEY, JSON.stringify(plan)]]);
    await page.getByRole('button', { name: '3D 檢視' }).first().click();
    await page.waitForSelector('[aria-label="3D floor-plan view"] canvas');
    await page.locator('.three-toolbar select').selectOption('full');
    await page.mouse.move(1439, 899); await page.waitForTimeout(2500);
    // The warning notice of a plan with tolerable issues lies over the canvas; close it, so only the model is compared.
    if (await page.locator('[data-replace-notice]').count()) { await page.getByRole('button', { name: '關閉通知' }).click(); await page.mouse.move(1439, 899); await page.waitForTimeout(500); }
    return page.locator('[aria-label="3D floor-plan view"] canvas').screenshot();
  };
  await page.goto(url);

  // 1. Tolerable issues in a saved plan are warnings: the plan opens, draws, and keeps its data.
  const expected = validatePlan(tolerable, 'saved');
  check('core: the test plan is valid as a saved plan, with only warnings', expected.ok && expected.errors.length === 0 && expected.warnings.length === 9,
    expected.warnings.map(w => w.code).join(', '));
  check('core: the same plan fails as an import', validatePlan(tolerable, 'import').errors.length === 9);
  const raw = JSON.stringify(tolerable);
  await load([[KEY, raw]]);
  const notice = page.locator('[data-replace-notice]');
  check('tolerable: the plan opens with a warning notice', (await notice.count()) === 1 && (await notice.innerText()).includes('9 個需要注意'));
  check('tolerable: no load error', !(await page.locator('[role=status]').first().innerText()).includes('無法載入'));
  await openPanel();
  const warningLines = await listed('[data-plan-warnings]');
  check('tolerable: the plan panel lists every warning', warningLines.length === 9, `${warningLines.length} lines`);
  check('tolerable: each line has the path, for an agent', expected.warnings.every((w, i) => warningLines[i].endsWith(`（${w.path}）`)), warningLines[0]);
  if (imageDir) await page.screenshot({ path: join(imageDir, 'tolerable-2d.png') });
  await page.getByRole('button', { name: '3D 檢視' }).first().click();
  await page.waitForSelector('[aria-label="3D floor-plan view"] canvas'); await page.waitForTimeout(2500);
  check('tolerable: 3D opens with no error overlay', (await page.locator('.three-error').count()) === 0);
  if (imageDir) await page.screenshot({ path: join(imageDir, 'tolerable-3d.png') });
  await page.getByRole('button', { name: '2D 平面圖' }).first().click();
  check('tolerable: autosave keeps every stored value (nothing is repaired)', (await read(KEY)) === raw);

  // The demolished exterior wall can be restored in the editor, which clears that warning; it cannot be demolished again.
  await page.locator('rect[data-wall-id="w4"]').first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  const restoreWall = page.getByRole('button', { name: '恢復牆體' });
  check('demolished exterior wall: the restore button is enabled', await restoreWall.isEnabled());
  await restoreWall.click(); await settle();
  check('demolished exterior wall: restored, and the warning is gone', JSON.parse(await read(KEY)).walls[3].demolished === false &&
    (await listed('[data-plan-warnings]')).length === 8 && !(await listed('[data-plan-warnings]')).some(l => l.includes('walls[3]')));
  check('demolished exterior wall: it cannot be demolished again', await page.getByRole('button', { name: '標記拆除' }).isDisabled());
  await page.keyboard.press('Escape');

  // 2. Heights out of range are drawn clamped: a door head of 3500 draws as 2800 (the ceiling), a sill of -100 as 0.
  const outOfRange = variant(p => { p.openings[1].head = 3500; p.openings[0].sill = -100; });
  const clamped = variant(p => { p.openings[1].head = 2800; p.openings[0].sill = 0; });
  const lower = variant(p => { p.openings[1].head = 2100; p.openings[0].sill = 0; });
  const [shotOut, shotClamped, shotLower] = [await shot3d(outOfRange), await shot3d(clamped), await shot3d(lower)];
  if (imageDir) { await writeFile(join(imageDir, 'heights-out.png'), shotOut); await writeFile(join(imageDir, 'heights-clamped.png'), shotClamped); }
  check('heights: out-of-range heights draw the same as the clamped values', shotOut.equals(shotClamped));
  check('heights control: a different door head draws differently', !shotLower.equals(shotClamped));
  await page.getByRole('button', { name: '2D 平面圖' }).first().click();

  // 3. An error that blocks rendering follows the H2 path, with a message that names the field and the path.
  const blocking = JSON.stringify(variant(p => { p.walls[0].thickness = 5; }));
  await load([[KEY, blocking]]);
  const status = await page.locator('[role=status]').first().innerText();
  check('blocking: the load error names the field and the path', status.includes('無法載入已儲存的平面圖') && status.includes('第 1 段牆的厚度') && status.includes('（walls[0].thickness）'), status);
  check('blocking: the data is kept in the recovery copy, and not overwritten', (await read(RECOVERY)) === blocking && (await read(KEY)) === blocking);
  await openPanel();
  check('blocking: the plan panel lists the error', (await listed('[data-load-errors]')).length === 1);

  // 4. Show the first 20 errors and the total count.
  const many = JSON.stringify(variant(p => { p.furniture = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, type: 'sofa', name: 'x', cx: 0, cy: 0, w: 0, d: 500, rot: 0 })); }));
  await load([[KEY, many]]);
  await openPanel();
  const manyLines = await listed('[data-load-errors]');
  check('many errors: 20 are listed, then the count', manyLines.length === 21 && manyLines[20] === '還有 5 個未列出（共 25 個）', `${manyLines.length} lines, last: ${manyLines.at(-1)}`);
  check('many errors: the status gives the total', (await page.locator('[role=status]').first().innerText()).includes('（共 25 個問題）'));

  // 5. A v1 saved plan uses the same policy: a tolerable issue is a warning, and the plan opens.
  const v1 = JSON.parse(await readFile(new URL('../../packages/core/test/fixtures/sample-v1.json', import.meta.url), 'utf8'));
  v1.rooms[0].mat = 'granite';
  await load([[KEY, JSON.stringify(v1)]]);
  check('v1: a plan with a missing room material opens with a warning', !(await page.locator('[role=status]').first().innerText()).includes('無法載入') &&
    (await notice.innerText()).includes('1 個需要注意') && JSON.parse(await read(KEY)).schemaVersion === 2);

  // 6. B1 restore of a backup with tolerable issues: it opens, with the count in the notice.
  await load([[KEY, JSON.stringify(base())], [BACKUP, raw]]);
  await openPanel();
  await page.locator('#settings-sidebar').getByRole('button', { name: '復原上一個平面圖' }).click(); await settle();
  check('restore: a backup with tolerable issues opens, and the notice gives the count', (await notice.innerText()).includes('9 個需要注意') && (await read(KEY)) === raw);
  check('restore: the backup is kept', (await read(BACKUP)) === raw);

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

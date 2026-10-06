// Browser check: demolishing a partition wall removes its door in 2D and 3D, and restoring the wall brings both back.
// Usage: node tools/checks/demolition.mjs <url>   (for example the `vite preview` URL). Exit code 0 means every check passed.
import { chromium } from 'playwright-core';

const url = process.argv[2];
if (!url) { console.error('Usage: node tools/checks/demolition.mjs <url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'open-plan:document:v1';

// One continuous partition wall with a door: the wall has two solid parts, so it can be selected in 2D.
const plan = {
  schemaVersion: 2, id: 'demolition-check', name: 'Demolition check', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
  walls: [
    { id: 'outer', type: 'e', a: [3000, 3000], b: [9000, 3000], thickness: 200 },
    { id: 'part', type: 'n', a: [3000, 5000], b: [9000, 5000], thickness: 120 },
  ],
  openings: [{ id: 'd1', type: 'door', wallId: 'part', offset: 2000, width: 900, hinge: 'start', swing: 'right', head: 2100 }],
  rooms: [{ id: 'r1', name: '房間', mat: 'wood', poly: [[3000, 3100], [9000, 3100], [9000, 4940], [3000, 4940]] }],
  materials: { wood: { name: '橡木地板', sw: '#d8b88a' } },
  furniture: [], measurements: [], dimensions: [],
};

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = async () => JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
  const wallParts = () => page.locator('rect[data-wall-id="part"]');
  const door2d = () => page.locator('g[data-opening-id="d1"]');
  const shot3d = async () => {
    await page.getByRole('button', { name: '3D 檢視' }).first().click();
    await page.waitForSelector('[aria-label="3D floor-plan view"] canvas');
    await page.locator('.three-toolbar select').selectOption('full');
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(2500);
    // Undo and redo are enabled after the edits, which is correct; mask them so only the 3D model is compared.
    const png = await page.locator('[aria-label="3D floor-plan view"] canvas').screenshot({ mask: [page.getByRole('button', { name: '復原' }), page.getByRole('button', { name: '重做' })] });
    await page.getByRole('button', { name: '2D 平面圖' }).first().click();
    await page.waitForSelector('svg.plan-svg');
    return png;
  };
  const toggle = async label => {
    await wallParts().first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
    await page.getByRole('button', { name: label }).click();
    await page.waitForTimeout(600);
    // Clear the wall selection, so the 3D images compare the walls, not the selection highlight.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  };

  const load = async p => {
    await page.evaluate(([k, s]) => { localStorage.clear(); localStorage.setItem(k, s); }, [KEY, JSON.stringify(p)]);
    await page.reload();
    await page.waitForSelector('svg.plan-svg');
  };

  await page.goto(url);
  await load(plan);
  check('test plan loads', (await page.locator('[role=alert]').count()) === 0);
  check('before: wall has 2 solid parts and the door is drawn', (await wallParts().count()) === 2 && (await door2d().count()) === 1);
  const before3d = await shot3d();

  await toggle(/標記拆除/);
  const demolished = await saved();
  check('demolish: wall is saved as demolished', demolished.walls.find(w => w.id === 'part').demolished === true);
  check('demolish: door data is kept', demolished.openings.some(o => o.id === 'd1'));
  check('demolish: 2D shows the wall as one demolished part and no door', (await wallParts().count()) === 1 && (await door2d().count()) === 0 && (await wallParts().first().getAttribute('fill')) === '#ef4444');
  const demolished3d = await shot3d();
  check('demolish: 3D changes', !demolished3d.equals(before3d));

  await toggle(/恢復牆體/);
  check('restore: wall is not demolished', !(await saved()).walls.find(w => w.id === 'part').demolished);
  check('restore: 2D shows 2 parts and the door again', (await wallParts().count()) === 2 && (await door2d().count()) === 1);
  const restored3d = await shot3d();
  check('restore: 3D is pixel-identical to before', restored3d.equals(before3d));
  if (!restored3d.equals(before3d) && process.env.SAVE_DIFF) { const { writeFileSync } = await import('node:fs'); writeFileSync(`${process.env.SAVE_DIFF}-before.png`, before3d); writeFileSync(`${process.env.SAVE_DIFF}-restored.png`, restored3d); }

  // Independent reference: the same wall saved as demolished, with the door removed from the data.
  // A pixel match proves that no door mesh is left in the demolished scene, not only that the wall changed.
  await load({ ...plan, walls: plan.walls.map(w => w.id === 'part' ? { ...w, demolished: true } : w), openings: [] });
  check('demolish: 3D is pixel-identical to the same plan with no door', demolished3d.equals(await shot3d()));

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

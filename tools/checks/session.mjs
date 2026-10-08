// Browser check for roadmap C3c: the website session snapshot and the website mode indicator.
// The first write of a page load that changes the saved plan keeps the old saved plan first (a separate key); a reload
// without a change keeps that copy; 復原開始編輯前的平面圖 brings it back as a replacement; a failed copy refuses the write.
// Usage: node tools/checks/session.mjs <url>   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { openSample, PLAN_KEY } from './sample-plan.mjs';

const url = process.argv[2];
if (!url) { console.error('Usage: node tools/checks/session.mjs <url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SESSION = 'open-plan:document:v1:session', REPLACED = 'open-plan:document:v1:replaced', BEFORE_V2 = 'open-plan:document:v1:before-v2';
// A real export from the original v1 editor (packages/core/test/fixtures/README.md).
const v1Export = await readFile(new URL('../../packages/core/test/fixtures/export-v1-9e1715d.json', import.meta.url), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const read = key => page.evaluate(k => localStorage.getItem(k), key);
  const savedName = async () => JSON.parse(await read(PLAN_KEY))?.name;
  const settle = () => page.waitForTimeout(700);                       // longer than the 400 ms autosave delay
  const nameField = () => page.locator('header input').first();
  const rename = async name => { await nameField().fill(name); await nameField().press('Tab'); await settle(); };
  const restoreButton = () => page.getByRole('button', { name: '復原開始編輯前的平面圖' });
  const openPanel = async () => { if (!(await restoreButton().isVisible())) await page.getByRole('button', { name: 'Open Plan 專案設定' }).click(); };
  const reload = async () => { await page.reload(); await page.waitForSelector('svg.plan-svg'); await settle(); };

  await page.goto(url);
  await openSample(page);
  // 1. The mode indicator.
  check('indicator: website mode and browser storage', (await page.locator('[data-storage-mode="website"]').innerText()) === '網站模式 · 儲存在此瀏覽器');
  await openPanel();
  check('panel: the privacy text and the storage help are for the website', (await page.locator('[data-privacy]').innerText()).includes('此網站版把資料存在這個瀏覽器中') &&
    (await page.locator('[data-storage-help]').innerText()).includes('專案保存在這個瀏覽器內'));

  // 2. A page load without a change takes no copy (autosave runs at load too).
  await page.evaluate(k => localStorage.removeItem(k), SESSION);
  await reload(); await openPanel();
  check('no change: no copy, and the restore button is off', (await read(SESSION)) === null && await restoreButton().isDisabled());

  // 2b. Saved bytes that differ from the opened plan without an edit (omitted default heights, other formatting, v1) are
  // not a change: no session copy, and an existing copy stays.
  const sample = JSON.parse(await read(PLAN_KEY));
  const noHeights = structuredClone(sample);
  delete noHeights.ceilingHeight;
  for (const o of noHeights.openings) { delete o.sill; delete o.head; }
  for (const [name, text] of [['omitted heights', JSON.stringify(noHeights)], ['other formatting', JSON.stringify(sample, null, 2)]]) {
    await page.evaluate(([k, s, t]) => { localStorage.setItem(k, t); localStorage.setItem(s, '{"earlier":"copy"}'); }, [PLAN_KEY, SESSION, text]);
    await reload();
    check(`${name}: a load without an edit keeps the saved bytes and the earlier copy`, (await read(PLAN_KEY)) === text && (await read(SESSION)) === '{"earlier":"copy"}');
    await rename(`Edited after ${name}`);
    check(`${name}: the first edit keeps the saved bytes exactly`, (await read(SESSION)) === text && (await savedName()) === `Edited after ${name}`);
  }
  // A saved v1 plan is still saved as v2 at load (roadmap B2, the v1 bytes in before-v2), but that is not an edit.
  await page.evaluate(([k, s, t]) => { localStorage.setItem(k, t); localStorage.setItem(s, '{"earlier":"copy"}'); }, [PLAN_KEY, SESSION, v1Export]);
  await reload();
  check('v1: the load saves version 2, keeps the v1 bytes, and keeps the earlier copy', JSON.parse(await read(PLAN_KEY)).schemaVersion === 2 &&
    (await read(BEFORE_V2)) === v1Export && (await read(SESSION)) === '{"earlier":"copy"}');
  await openSample(page);
  await page.evaluate(k => localStorage.removeItem(k), SESSION);
  await reload(); await openPanel();

  // 3. The first change keeps the saved plan first; later changes do not replace that copy.
  const before = await read(PLAN_KEY);
  await rename('Session B');
  check('first change: the saved plan from before it is kept exactly', (await read(SESSION)) === before && (await savedName()) === 'Session B');
  check('first change: the restore button is on', await restoreButton().isEnabled());
  await rename('Session C');
  check('later change: the copy stays the plan from before the first change', (await read(SESSION)) === before && (await savedName()) === 'Session C');

  // 4. A reload (for example after a mistake) without a change keeps the copy.
  await reload(); await openPanel();
  check('reload: the copy survives, and the restore button is on', (await read(SESSION)) === before && await restoreButton().isEnabled());

  // 5. 復原開始編輯前的平面圖 is a replacement: the open plan is backed up first, and the copy loads.
  await restoreButton().click(); await settle();
  const original = JSON.parse(before).name;
  check('restore: the plan from before the first change is open and saved', (await nameField().inputValue()) === original && (await savedName()) === original);
  check('restore: the plan it replaced is the replacement backup', JSON.parse(await read(REPLACED))?.name === 'Session C');
  check('restore: 復原上一個平面圖 is offered in the notice', (await page.locator('[data-replace-notice]').getByRole('button', { name: '復原上一個平面圖' }).count()) === 1);

  // 6. A failed copy refuses the first write; the saved plan stays.
  await page.addInitScript(key => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === key) throw new DOMException('full', 'QuotaExceededError'); return setItem.call(this, k, v); };
  }, SESSION);
  await reload();
  const savedBefore = await read(PLAN_KEY), copyBefore = await read(SESSION);
  await rename('Not saved');
  check('failed copy: the write is refused and the saved plan and its copy stay', (await read(PLAN_KEY)) === savedBefore && (await read(SESSION)) === copyBefore);
  check('failed copy: the status says so', (await page.locator('[role="status"]').first().innerText()).includes('儲存失敗：無法先備份已儲存的平面圖'));

  // 7. With nothing saved, an older copy (from another plan) is removed at the first write.
  const fresh = await context.newPage();
  await fresh.goto(url);
  await fresh.evaluate(([k, s]) => { localStorage.clear(); localStorage.setItem(s, '{"old":"copy of another plan"}'); }, [PLAN_KEY, SESSION]);
  await fresh.reload(); await fresh.waitForSelector('svg.plan-svg'); await fresh.waitForTimeout(700);
  check('nothing saved: the older copy is removed', (await fresh.evaluate(k => localStorage.getItem(k), SESSION)) === null);

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
if (failed) { console.error(`${failed} of ${results.length} checks failed.`); process.exit(1); }
console.log(`All ${results.length} checks passed.`);

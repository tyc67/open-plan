// Browser check for old finding L6, part 2 (website mode): two tabs with the same saved plan. A tab does not write
// after another tab changed the saved plan; it shows a notice that stays, with 2 actions. 載入另一個分頁的版本 keeps this
// tab's plan first and loads the stored one; 保留這個分頁的版本 keeps the stored one first and writes this tab's plan.
// Usage: node tools/checks/tabs.mjs <url>   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { openSample, PLAN_KEY } from './sample-plan.mjs';

const url = process.argv[2];
if (!url) { console.error('Usage: node tools/checks/tabs.mjs <url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPLACED = `${PLAN_KEY}:replaced`, RECOVERY = `${PLAN_KEY}:recovery`;

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const until = async (test, timeout = 4000) => { const start = Date.now(); while (Date.now() - start < timeout) { if (await test()) return true; await sleep(50); } return false; };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const tab = async () => { const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); return page; };
  const a = await tab();
  await a.goto(url); await openSample(a);
  const b = await tab();
  await b.goto(url); await b.waitForSelector('svg.plan-svg');
  const SETTLE = 800;                                                  // longer than the 400 ms autosave delay
  const text = key => a.evaluate(k => localStorage.getItem(k), key);
  const stored = async (key = PLAN_KEY) => { try { return JSON.parse(await text(key)); } catch { return null; } };
  const nameField = page => page.locator('header input').first();
  const rename = async (page, name) => { await nameField(page).fill(name); await nameField(page).press('Tab'); await sleep(SETTLE); };
  const notice = page => page.locator('[data-file-notice="tab-conflict"]');
  const shown = page => until(async () => (await notice(page).count()) === 1);
  const gone = page => until(async () => (await notice(page).count()) === 0);
  const act = (page, label) => notice(page).getByRole('button', { name: label }).click();
  const status = page => page.locator('[role="status"]').last().innerText();
  const undoSteps = page => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(x => x.textContent.includes('步驟')).length);
  await sleep(SETTLE);
  check('two tabs with the same plan: no notice', (await notice(a).count()) === 0 && (await notice(b).count()) === 0);

  // 1. A change in tab A: tab B shows the notice, and does not write.
  await rename(a, 'From A');
  check('change in the other tab: the notice shows, with no edit in this tab', await shown(b));
  check('the notice cannot be closed, and has the 2 actions', (await notice(b).getByRole('button').allInnerTexts()).join('|') === '載入另一個分頁的版本|保留這個分頁的版本');
  await rename(b, 'From B');
  check('an edit in this tab is not written', (await stored()).name === 'From A', (await stored()).name);
  check('the status says why', (await status(b)).includes('沒有儲存：另一個分頁已變更這個平面圖'), await status(b));
  await b.getByRole('button', { name: /本機儲存|儲存到此裝置/ }).first().click(); await sleep(200);
  check('the save button does not write during the conflict', (await stored()).name === 'From A' && (await notice(b).count()) === 1);
  await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('a hide does not write during the conflict', (await stored()).name === 'From A');
  await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  check('the tab that wrote has no notice', (await notice(a).count()) === 0);

  // 2. 載入另一個分頁的版本.
  const stepsB = await undoSteps(b), before = await text(PLAN_KEY);
  await act(b, '載入另一個分頁的版本');
  check('load: this tab shows the stored plan, and the notice goes', await until(async () => (await nameField(b).inputValue()) === 'From A') && await gone(b));
  check('load: this tab\'s plan is the replaced copy', (await stored(REPLACED))?.name === 'From B', (await stored(REPLACED))?.name);
  check('load: it is one undo step, with the restore action', (await undoSteps(b)) === stepsB + 1 && (await b.locator('[data-replace-notice]').getByRole('button', { name: '復原上一個平面圖' }).count()) === 1);
  await sleep(SETTLE);
  check('load: the loaded plan is not written back, so the other tab gets no notice', (await text(PLAN_KEY)) === before && (await notice(a).count()) === 0);
  await rename(b, 'B after the load');
  check('load: a later edit is written, and the other tab then has the notice', (await stored()).name === 'B after the load' && await shown(a));

  // 3. 保留這個分頁的版本 (tab A has the conflict now).
  await rename(a, 'A keeps this');
  check('keep: the edit is not written before the decision', (await stored()).name === 'B after the load');
  await act(a, '保留這個分頁的版本');
  check('keep: this tab\'s plan is written, and the notice goes', await until(async () => (await stored()).name === 'A keeps this') && await gone(a));
  check('keep: the plan of the other tab is the replaced copy', (await stored(REPLACED))?.name === 'B after the load', (await stored(REPLACED))?.name);
  check('keep: the status says where the other plan is', (await status(a)).includes('復原上一個平面圖'), await status(a));
  check('keep: the other tab now has the notice', await shown(b));
  await rename(a, 'A goes on');
  check('keep: later edits are written', (await stored()).name === 'A goes on');

  // 4. The stored plan changes again while the notice is open: the action uses the newest one.
  await rename(a, 'A newest');
  await act(b, '載入另一個分頁的版本');
  check('load after a second change: the newest plan is loaded', await until(async () => (await nameField(b).inputValue()) === 'A newest'));

  // 5. The other tab stored data that cannot be opened: the load changes nothing; keep puts it in the recovery copy.
  await a.evaluate(k => localStorage.setItem(k, '{broken'), PLAN_KEY);
  check('unreadable data: the notice shows', await shown(b));
  await act(b, '載入另一個分頁的版本'); await sleep(300);
  check('unreadable data: the load is refused with its reason, and the plan stays', (await notice(b).innerText()).includes('另一個分頁的版本無法開啟') && (await nameField(b).inputValue()) === 'A newest' && (await text(PLAN_KEY)) === '{broken');
  await rename(b, 'B over broken data');
  check('unreadable data: still no write', (await text(PLAN_KEY)) === '{broken');
  await act(b, '保留這個分頁的版本');
  check('unreadable data: keep writes this plan, and the data is the recovery copy', await until(async () => (await stored())?.name === 'B over broken data') && (await text(RECOVERY)) === '{broken' && await gone(b));
  check('unreadable data: the status says so', (await status(b)).includes('另一個分頁的資料已另存備份'), await status(b));

  // 6. The other tab removed the saved plan.
  await b.evaluate(k => localStorage.removeItem(k), PLAN_KEY);
  check('removed plan: the notice shows', await shown(a));
  await act(a, '載入另一個分頁的版本'); await sleep(300);
  check('removed plan: the load is refused with its reason, and the plan stays', (await notice(a).innerText()).includes('已儲存的平面圖已被移除') && (await nameField(a).inputValue()) === 'A newest' && (await text(PLAN_KEY)) === null);
  await act(a, '保留這個分頁的版本');
  check('removed plan: keep writes this plan', await until(async () => (await stored())?.name === 'A newest') && await gone(a));

  // 7. The other tab put the known text back: there is nothing to decide, and the notice goes.
  const known = await text(PLAN_KEY);
  await b.evaluate(k => localStorage.setItem(k, '{"other":1}'), PLAN_KEY);
  check('text put back: the notice shows first', await shown(a));
  await rename(a, 'A edit during the conflict');
  check('text put back: an edit during the conflict is not written', (await text(PLAN_KEY)) === '{"other":1}');
  await b.evaluate(([k, t]) => localStorage.setItem(k, t), [PLAN_KEY, known]);
  check('text put back: the notice goes', await gone(a));
  check('text put back: the edit that waited is then written', await until(async () => (await stored())?.name === 'A edit during the conflict'), (await stored())?.name);

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
if (failed) { console.error(`${failed} of ${results.length} checks failed.`); process.exit(1); }
console.log(`All ${results.length} checks passed.`);

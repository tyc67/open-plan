// Browser check for old finding L6, part 2 (website mode): two tabs with the same saved plan. A tab with nothing to lose
// loads a change from the other tab. A tab with work (an edit that waits, a typed value, a gesture, an import dialog)
// does not write after another tab changed the saved plan; it shows a notice that stays, with 2 actions. 載入另一個分頁的版本 keeps this
// tab's plan first and loads the stored one; 保留這個分頁的版本 keeps the stored one first and writes this tab's plan.
// Usage: node tools/checks/tabs.mjs <url>   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { openSample, PLAN_KEY } from './sample-plan.mjs';

const url = process.argv[2];
if (!url) { console.error('Usage: node tools/checks/tabs.mjs <url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPLACED = `${PLAN_KEY}:replaced`, RECOVERY = `${PLAN_KEY}:recovery`;
// A real export from the original v1 editor (packages/core/test/fixtures/README.md).
const v1Export = await readFile(new URL('../../packages/core/test/fixtures/export-v1-9e1715d.json', import.meta.url), 'utf8');

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
  const typing = (page, name) => nameField(page).fill(name);          // a typed value in a focused field, not committed
  const commit = async page => { await nameField(page).press('Tab'); await sleep(SETTLE); };
  const hasName = (page, name) => until(async () => (await nameField(page).inputValue()) === name);
  const good = async name => JSON.stringify({ ...(await stored()), name });
  await sleep(SETTLE);
  check('two tabs with the same plan: no notice', (await notice(a).count()) === 0 && (await notice(b).count()) === 0);

  // 1. A tab with nothing to lose loads the change from the other tab: no notice, no write, no undo step.
  await rename(b, 'B first');
  check('automatic load: the tab with no edit shows the new plan', await hasName(a, 'B first') && (await notice(a).count()) === 0);
  await rename(a, 'From A');
  const afterA = await text(PLAN_KEY);
  check('automatic load: also in the tab that edited before', await hasName(b, 'From A') && (await notice(b).count()) === 0);
  check('automatic load: the undo history starts again', (await undoSteps(b)) === 0, `${await undoSteps(b)} steps`);
  check('automatic load: the status says so', (await status(b)).includes('已載入另一個分頁的新版本'), await status(b));
  await sleep(SETTLE);
  check('automatic load: nothing is written back', (await text(PLAN_KEY)) === afterA && (await notice(a).count()) === 0);
  await rename(b, 'B next');
  check('automatic load: the next edit is written, and the other tab loads it', (await stored()).name === 'B next' && await hasName(a, 'B next'));

  // 2. A typed value in a focused field: this tab has work that is not committed, so the notice shows.
  await typing(b, 'From B');
  await rename(a, 'From A');
  check('focused field: the notice shows, and the plan is not loaded', await shown(b) && (await nameField(b).inputValue()) === 'From B');
  check('the notice cannot be closed, and has the 2 actions', (await notice(b).getByRole('button').allInnerTexts()).join('|') === '載入另一個分頁的版本|保留這個分頁的版本');
  await commit(b);
  check('an edit in this tab is not written', (await stored()).name === 'From A', (await stored()).name);
  check('the status says why', (await status(b)).includes('沒有儲存：另一個分頁已變更這個平面圖'), await status(b));
  await b.getByRole('button', { name: /本機儲存|儲存到此裝置/ }).first().click(); await sleep(200);
  check('the save button does not write during the conflict', (await stored()).name === 'From A' && (await notice(b).count()) === 1);
  await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('a hide does not write during the conflict', (await stored()).name === 'From A');
  await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  check('a return to the page keeps the notice (this tab has an edit)', (await notice(b).count()) === 1 && (await nameField(b).inputValue()) === 'From B');
  check('the tab that wrote has no notice', (await notice(a).count()) === 0);

  // 3. 載入另一個分頁的版本.
  const stepsB = await undoSteps(b), before = await text(PLAN_KEY);
  await act(b, '載入另一個分頁的版本');
  check('load: this tab shows the stored plan, and the notice goes', await hasName(b, 'From A') && await gone(b));
  check('load: this tab\'s plan is the replaced copy', (await stored(REPLACED))?.name === 'From B', (await stored(REPLACED))?.name);
  check('load: it is one undo step, with the restore action', (await undoSteps(b)) === stepsB + 1 && (await b.locator('[data-replace-notice]').getByRole('button', { name: '復原上一個平面圖' }).count()) === 1);
  await sleep(SETTLE);
  check('load: the loaded plan is not written back, so the other tab gets no notice', (await text(PLAN_KEY)) === before && (await notice(a).count()) === 0);
  await rename(b, 'B after the load');
  check('load: a later edit is written', (await stored()).name === 'B after the load' && await hasName(a, 'B after the load'));

  // 4. 保留這個分頁的版本.
  await typing(a, 'A keeps this');
  await rename(b, 'B again');
  check('keep: the notice shows', await shown(a));
  await commit(a);
  check('keep: the edit is not written before the decision', (await stored()).name === 'B again');
  await act(a, '保留這個分頁的版本');
  check('keep: this tab\'s plan is written, and the notice goes', await until(async () => (await stored()).name === 'A keeps this') && await gone(a));
  check('keep: the plan of the other tab is the replaced copy', (await stored(REPLACED))?.name === 'B again', (await stored(REPLACED))?.name);
  check('keep: the status says where the other plan is', (await status(a)).includes('復原上一個平面圖'), await status(a));
  check('keep: the other tab had no edit, so it loads the kept plan', await hasName(b, 'A keeps this') && (await notice(b).count()) === 0);
  await rename(a, 'A goes on');
  check('keep: later edits are written', (await stored()).name === 'A goes on');

  // 5. The stored plan changes again while the notice is open: the action uses the newest one.
  await typing(b, 'B types');
  await rename(a, 'A newer');
  await shown(b);
  await rename(a, 'A newest');
  await act(b, '載入另一個分頁的版本');
  check('load after a second change: the newest plan is loaded', await hasName(b, 'A newest') && await gone(b));

  // 6. An edit that waits for its save (inside the 400 ms delay) when the other plan comes: the notice shows.
  await nameField(b).fill('B waits'); await nameField(b).press('Tab');
  await a.evaluate(([k, t]) => localStorage.setItem(k, t), [PLAN_KEY, await good('Stored meanwhile')]);
  check('waiting edit: the notice shows, and the edit is not written', await shown(b) && (await sleep(SETTLE), (await stored()).name === 'Stored meanwhile') && (await nameField(b).inputValue()) === 'B waits');
  await act(b, '保留這個分頁的版本');
  check('waiting edit: keep writes it', await until(async () => (await stored()).name === 'B waits') && await gone(b) && await hasName(a, 'B waits'));

  // 7. A gesture in progress: the notice shows.
  const box = await b.locator('[data-furniture-id]').first().boundingBox();
  await b.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await b.mouse.down();
  await b.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 3 });
  await rename(a, 'A during a drag');
  check('gesture: the notice shows, and the plan is not loaded', await shown(b) && (await nameField(b).inputValue()) === 'B waits');
  await b.mouse.up(); await sleep(SETTLE);
  check('gesture: the drag is not written', (await stored()).name === 'A during a drag');
  await act(b, '載入另一個分頁的版本');
  check('gesture: load shows the other plan', await hasName(b, 'A during a drag') && await gone(b));

  // 7b. A measurement with only its first point (click, then click): the notice shows, and the plan is not loaded.
  await b.keyboard.press('m');
  const canvas = await b.locator('svg.plan-svg').boundingBox();
  await b.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await b.mouse.move(canvas.x + canvas.width / 2 + 120, canvas.y + canvas.height / 2 + 40);
  await rename(a, 'A during a measurement');
  check('measurement with one point: the notice shows, and the plan is not loaded', await shown(b) && (await nameField(b).inputValue()) === 'A during a drag');
  await act(b, '載入另一個分頁的版本');
  check('measurement with one point: load shows the other plan', await hasName(b, 'A during a measurement') && await gone(b));
  await b.keyboard.press('Escape'); await b.locator('[data-tool="select"]').click();   // the hint of the measure tool takes the place of the status

  // 8. An open import dialog: the notice shows.
  await b.locator('[data-import-input]').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(await good('Imported')) });
  await b.locator('[role=dialog]').waitFor();
  await rename(a, 'A during an import');
  check('import dialog: the notice shows, and the plan is not loaded', await shown(b) && (await nameField(b).inputValue()) === 'A during a measurement');
  await b.locator('[role=dialog]').getByRole('button', { name: '取消' }).click();
  await act(b, '載入另一個分頁的版本');
  check('import dialog: load shows the other plan', await hasName(b, 'A during an import') && await gone(b));
  await rename(a, 'A newest'); await hasName(b, 'A newest');

  // 9. The other tab stored data that cannot be opened: no automatic load; the load action changes nothing; keep puts
  // it in the recovery copy.
  await a.evaluate(k => localStorage.setItem(k, '{broken'), PLAN_KEY);
  check('unreadable data: the notice shows in a tab with no edit', await shown(b) && (await nameField(b).inputValue()) === 'A newest');
  await act(b, '載入另一個分頁的版本'); await sleep(300);
  check('unreadable data: the load is refused with its reason, and the plan stays', (await notice(b).innerText()).includes('另一個分頁的版本無法開啟') && (await nameField(b).inputValue()) === 'A newest' && (await text(PLAN_KEY)) === '{broken');
  await rename(b, 'B over broken data');
  check('unreadable data: still no write', (await text(PLAN_KEY)) === '{broken');
  await act(b, '保留這個分頁的版本');
  check('unreadable data: keep writes this plan, and the data is the recovery copy', await until(async () => (await stored())?.name === 'B over broken data') && (await text(RECOVERY)) === '{broken' && await gone(b));
  check('unreadable data: the status says so', (await status(b)).includes('另一個分頁的資料已另存備份'), await status(b));
  await hasName(a, 'B over broken data');

  // 10. The other tab removed the saved plan: no automatic load, and an empty plan never takes the place of this one.
  await b.evaluate(k => localStorage.removeItem(k), PLAN_KEY);
  check('removed plan: the notice shows in a tab with no edit', await shown(a) && (await nameField(a).inputValue()) === 'B over broken data');
  await act(a, '載入另一個分頁的版本'); await sleep(300);
  check('removed plan: the load is refused with its reason, and the plan stays', (await notice(a).innerText()).includes('已儲存的平面圖已被移除') && (await nameField(a).inputValue()) === 'B over broken data' && (await text(PLAN_KEY)) === null);
  await act(a, '保留這個分頁的版本');
  check('removed plan: keep writes this plan', await until(async () => (await stored())?.name === 'B over broken data') && await gone(a));

  // 11. The other tab put the known text back: there is nothing to decide, and the notice goes.
  await rename(a, 'A base'); await hasName(b, 'A base');
  const known = await text(PLAN_KEY);
  await b.evaluate(k => localStorage.setItem(k, '{"other":1}'), PLAN_KEY);
  check('text put back: the notice shows first', await shown(a));
  await rename(a, 'A edit during the conflict');
  check('text put back: an edit during the conflict is not written', (await text(PLAN_KEY)) === '{"other":1}');
  await b.evaluate(([k, t]) => localStorage.setItem(k, t), [PLAN_KEY, known]);
  check('text put back: the notice goes', await gone(a));
  check('text put back: the edit that waited is then written', await until(async () => (await stored())?.name === 'A edit during the conflict'), (await stored())?.name);
  await hasName(b, 'A edit during the conflict');

  // 12. The same plan in other bytes (another formatting): no notice, no load, no write; the undo history stays.
  const stepsA = await undoSteps(a), pretty = JSON.stringify(await stored(), null, 2);
  await b.evaluate(([k, t]) => localStorage.setItem(k, t), [PLAN_KEY, pretty]);
  await sleep(SETTLE);
  check('equal plan in other bytes: no notice, and the undo history stays', (await notice(a).count()) === 0 && (await undoSteps(a)) === stepsA && stepsA > 0, `${stepsA} steps`);
  check('equal plan in other bytes: nothing is written', (await text(PLAN_KEY)) === pretty);
  await rename(a, 'A after equal bytes');
  check('equal plan in other bytes: the next edit is written', (await stored()).name === 'A after equal bytes');
  await a.close(); await b.close();

  // 13. Two tabs open the same v1 plan: the migration write of one is not a conflict for the other.
  const seed = await tab(); await seed.goto(url);
  await seed.evaluate(([k, t]) => { localStorage.clear(); localStorage.setItem(k, t); }, [PLAN_KEY, v1Export]);
  const [c, d] = [await tab(), await tab()];
  await Promise.all([c.goto(url), d.goto(url)]);
  await c.waitForSelector('svg.plan-svg'); await d.waitForSelector('svg.plan-svg'); await sleep(1500);
  const migrated = JSON.parse(await seed.evaluate(k => localStorage.getItem(k), PLAN_KEY));
  check('two tabs with a v1 plan: the plan is migrated, and no tab has a notice', migrated.schemaVersion === 2 && (await notice(c).count()) === 0 && (await notice(d).count()) === 0, `schema ${migrated.schemaVersion}`);
  check('two tabs with a v1 plan: both show the same plan', (await nameField(c).inputValue()) === (await nameField(d).inputValue()) && (await nameField(c).inputValue()) === migrated.name);
  await d.close();

  // 14. Autosave is paused after a load error: a good plan from another tab is not loaded without a decision.
  await seed.evaluate(k => localStorage.setItem(k, '{broken'), PLAN_KEY);
  await c.reload(); await c.waitForSelector('svg.plan-svg'); await sleep(SETTLE);
  const paused = await nameField(c).inputValue();
  await seed.evaluate(([k, t]) => localStorage.setItem(k, t), [PLAN_KEY, JSON.stringify({ ...migrated, name: 'Good plan from another tab' })]);
  check('paused autosave: the notice shows, and the plan is not loaded', (await until(async () => (await notice(c).count()) === 1)) && (await nameField(c).inputValue()) === paused);

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
if (failed) { console.error(`${failed} of ${results.length} checks failed.`); process.exit(1); }
console.log(`All ${results.length} checks passed.`);

// Browser check for old finding L6, part 1 (website mode): autosave and the save when the page hides write only
// committed data. A furniture or label drag that stops for longer than the 400 ms autosave delay does not store its
// preview; an edit is stored when the page hides or closes before the delay ends; a paused autosave stays paused.
// Usage: node tools/checks/save-on-hide.mjs <url>   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { openSample, PLAN_KEY } from './sample-plan.mjs';

const url = process.argv[2];
if (!url) { console.error('Usage: node tools/checks/save-on-hide.mjs <url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const text = () => page.evaluate(k => localStorage.getItem(k), PLAN_KEY);
  const saved = async () => JSON.parse(await text());
  const HOLD = 900;                                                    // longer than the 400 ms autosave delay
  const nameField = () => page.locator('header input').first();
  const rename = async name => { await nameField().fill(name); await nameField().press('Tab'); };
  const item = (p, id) => { const f = p.furniture.find(x => x.id === id); return `${f.cx},${f.cy}`; };
  const labelAt = (p, id) => String(p.rooms.find(r => r.id === id).at);
  /** Starts a 2D drag and keeps the button down: the preview is in the plan state. */
  const holdDrag = async selector => {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 4 });
  };
  /** The page goes to the background, as the browser reports it. */
  const hide = hidden => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);

  await page.goto(url);
  const sample = await openSample(page);
  await page.waitForTimeout(HOLD);
  const furnitureId = sample.furniture[0].id, roomId = sample.rooms[0].id;
  const furniture = `[data-furniture-id="${furnitureId}"]`, label = `[data-room-label-id="${roomId}"]`;

  // 1. A furniture drag that stops: the preview is on the screen, and it is not stored.
  const start = await text();
  await holdDrag(furniture);
  const preview = await page.locator(furniture).boundingBox();
  await page.waitForTimeout(HOLD);
  check('furniture drag held: the stored plan does not change', (await text()) === start);
  await page.mouse.up(); await page.waitForTimeout(HOLD);
  const moved = await saved();
  check('furniture drag released: the new position is stored', item(moved, furnitureId) !== item(sample, furnitureId), item(moved, furnitureId));
  check('furniture drag: the preview was a real move', Math.abs(preview.x - (await page.locator(furniture).boundingBox()).x) < 1);

  // 2. The same for a room label.
  const beforeLabel = await text();
  await holdDrag(label);
  await page.waitForTimeout(HOLD);
  check('label drag held: the stored plan does not change', (await text()) === beforeLabel);
  await page.mouse.up(); await page.waitForTimeout(HOLD);
  check('label drag released: the new position is stored', labelAt(await saved(), roomId) !== labelAt(sample, roomId));

  // 3. An edit, then a drag that starts before the autosave: the edit is stored during the drag, the preview is not.
  const beforeDrag = await saved();
  await rename('Edit before a drag'); await holdDrag(furniture);
  await page.waitForTimeout(HOLD);
  const during = await saved();
  check('edit then drag held: the edit is stored', during.name === 'Edit before a drag', during.name);
  check('edit then drag held: the preview is not stored', item(during, furnitureId) === item(beforeDrag, furnitureId));
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(HOLD);
  check('drag cancelled: the position is the one from before the drag', item(await saved(), furnitureId) === item(beforeDrag, furnitureId));

  // 4. The page hides during a drag, before the autosave of an earlier edit: the edit is stored at once, the preview is
  // not (the editor cancels the drag in the same event).
  await rename('Edit before hide'); await holdDrag(furniture); await hide(true);
  const hidden = await saved();
  check('hide during a drag: the earlier edit is stored at once', hidden.name === 'Edit before hide', hidden.name);
  check('hide during a drag: the preview is not stored', item(hidden, furnitureId) === item(beforeDrag, furnitureId));
  await hide(false); await page.mouse.up(); await page.waitForTimeout(HOLD);
  check('hide during a drag: the drag is dropped', item(await saved(), furnitureId) === item(beforeDrag, furnitureId));

  // 5. The page hides with no change: nothing is written.
  const writes = await page.evaluate(() => { window.__writes = 0; const set = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { window.__writes++; return set.apply(this, a); }; return 0; });
  await hide(true); await hide(false);
  check('hide with no change: no write', (await page.evaluate(() => window.__writes)) === writes);

  // 6. An edit, then the page goes away before the autosave delay ends (a reload sends pagehide).
  await page.waitForTimeout(HOLD); await rename('Edit before close');
  await page.reload(); await page.waitForSelector('svg.plan-svg');
  check('close inside the delay: the edit is stored', (await saved()).name === 'Edit before close' && (await nameField().inputValue()) === 'Edit before close', (await saved()).name);

  // 6b. The page hides in the same task as the commit, before a render or an effect: the edit is stored.
  await nameField().fill('Edit and hide at once');
  await page.evaluate(() => { document.activeElement.blur(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('hide in the same task as the edit: the edit is stored', (await saved()).name === 'Edit and hide at once', (await saved()).name);
  await hide(false); await page.waitForTimeout(HOLD);

  // 6c. A save that fails leaves the edit waiting: the next hide stores it.
  await page.evaluate(k => { const set = Storage.prototype.setItem; window.__full = true; Storage.prototype.setItem = function (key, v) { if (window.__full && key === k) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, key, v); }; }, PLAN_KEY);
  await rename('Stored at the second try'); await page.waitForTimeout(HOLD);
  check('failed autosave: the edit is not stored, and the status says so', (await saved()).name === 'Edit and hide at once' && (await page.locator('[role="status"]').first().innerText()).includes('儲存失敗'));
  await page.evaluate(() => { window.__full = false; }); await hide(true);
  check('failed autosave: the next hide stores the edit', (await saved()).name === 'Stored at the second try', (await saved()).name);
  await hide(false);

  // 7. Autosave is paused after a load error; the save at hide and at close obeys the pause.
  await page.evaluate(k => localStorage.setItem(k, '{not a plan'), PLAN_KEY);
  await page.reload(); await page.waitForSelector('svg.plan-svg');
  await rename('Must not be stored'); await hide(true); await hide(false);
  check('paused autosave: hide does not overwrite the unreadable plan', (await text()) === '{not a plan');
  await rename('Must not be stored 2');
  await page.reload(); await page.waitForSelector('svg.plan-svg');
  check('paused autosave: close does not overwrite the unreadable plan', (await text()) === '{not a plan');

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
if (failed) { console.error(`${failed} of ${results.length} checks failed.`); process.exit(1); }
console.log(`All ${results.length} checks passed.`);

// Browser check for roadmap B1: safe replacement of the open plan (new empty plan, load sample) and restore.
// Usage: node tools/checks/replace.mjs <url>   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../apps/web/node_modules/three/build/three.module.js';
import { cameraPose, createViewFrame, fitBounds, toSceneX, toSceneZ } from '../../packages/core/dist/index.js';

const url = process.argv[2];
if (!url) { console.error('Usage: node tools/checks/replace.mjs <url>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'open-plan:document:v1', BACKUP = 'open-plan:document:v1:replaced', RECOVERY = 'open-plan:document:v1:recovery';
const H2_SENTINEL = '{"h2":"recovery copy from an earlier load error"}';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const at = (plan, id) => { const f = plan?.furniture.find(x => x.id === id); return f ? [f.cx, f.cy] : null; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const read = key => page.evaluate(k => localStorage.getItem(k), key);
  const saved = async () => JSON.parse(await read(KEY));
  const backup = async () => JSON.parse(await read(BACKUP));
  const settle = () => page.waitForTimeout(700);                       // longer than the 400 ms autosave delay
  // Clicks a plan-panel button from script, so focus stays where it is (a pending field edit is not blurred by the click).
  const panelClick = name => page.evaluate(n => {
    const active = document.activeElement;
    const button = [...document.querySelectorAll('#settings-sidebar button')].find(b => b.textContent.trim() === n);
    button.click();
    return { activeTag: active?.tagName, activeType: active?.getAttribute('type') };
  }, name);
  const undoSteps = () => page.evaluate(() => [...document.querySelectorAll('#history-content button')].filter(b => b.textContent.includes('步驟')).length);
  const xField = () => page.locator('.inspector label').filter({ hasText: /^X/ }).locator('input');
  const select2d = id => page.locator(`[data-furniture-id="${id}"]`).click();
  const noSelection = async () => (await page.locator('.inspector h3').count()) === 0 && (await page.locator('#properties-content').innerText()).includes('選取家具或空間');
  // The 2D view box that "Fit" gives for a plan: fitBounds scaled to the SVG size and centred.
  const fitMatches = async plan => {
    const [vx, vy, vw, vh] = (await page.locator('svg.plan-svg').getAttribute('viewBox')).split(' ').map(Number);
    const { w, h } = await page.evaluate(() => { const s = document.querySelector('svg.plan-svg'); return { w: s.clientWidth, h: s.clientHeight }; });
    const [x0, y0, x1, y1] = fitBounds(plan), scale = Math.min(w / (x1 - x0), h / (y1 - y0)), ew = w / scale, eh = h / scale;
    const expected = [(x0 + x1) / 2 - ew / 2, (y0 + y1) / 2 - eh / 2, ew, eh];
    return { ok: [vx, vy, vw, vh].every((v, i) => Math.abs(v - expected[i]) < 1e-6), detail: `view ${[vx, vy, vw, vh].map(Math.round)}, fit ${expected.map(Math.round)}` };
  };

  await page.goto(url);
  await page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [RECOVERY, H2_SENTINEL]);
  await page.reload();
  await page.waitForSelector('svg.plan-svg');
  await settle();
  await page.getByRole('button', { name: 'Open Plan 專案設定' }).click();
  const fresh = await saved();
  check('restore is not offered before any replacement', await page.locator('#settings-sidebar').getByRole('button', { name: '復原上一個平面圖' }).isDisabled());

  // 1. An edit less than 400 ms old (not yet autosaved) survives the replacement and comes back with restore.
  await select2d('sample-f1');
  await xField().fill('8000'); await xField().press('Enter');
  const steps0 = await undoSteps();
  const atClick = await page.evaluate(([k]) => {
    const savedCx = JSON.parse(localStorage.getItem(k)).furniture.find(f => f.id === 'sample-f1').cx;
    [...document.querySelectorAll('#settings-sidebar button')].find(b => b.textContent.trim() === '載入範例公寓').click();
    return savedCx;
  }, [KEY]);
  await settle();
  const edited = await backup(), replaced = await saved();
  check('edit: not yet autosaved when the replacement started', atClick === 8300, `saved cx ${atClick} at the click`);
  check('edit: the backup has the edit', at(edited, 'sample-f1')?.[0] === 8000 && edited.id === fresh.id, `backup cx ${at(edited, 'sample-f1')?.[0]}`);
  check('replace: a new sample is open and saved', replaced.id !== fresh.id && at(replaced, 'sample-f1')?.[0] === 8300);
  check('replace: one undo step', await undoSteps() === steps0 + 1, `${steps0} → ${await undoSteps()}`);
  check('replace: the status offers restore', (await page.locator('[data-replace-notice]').getByRole('button', { name: '復原上一個平面圖' }).count()) === 1);

  // 4. Restore brings the backup back and keeps it, so restore stays usable until the next replacement.
  await panelClick('復原上一個平面圖'); await settle();
  const restored = await saved();
  check('restore: the plan from before the replacement is back, with the edit', restored.id === fresh.id && at(restored, 'sample-f1')?.[0] === 8000);
  check('restore: the backup is kept', same(await backup(), edited));
  check('restore: one more undo step', await undoSteps() === steps0 + 2);
  const restoreButton = page.locator('#settings-sidebar').getByRole('button', { name: '復原上一個平面圖' });
  check('restore: the action is still available', await restoreButton.isEnabled());
  await page.getByRole('button', { name: '復原', exact: true }).first().click(); await settle();
  check('undo after restore goes back to the replacement plan', (await saved()).id === replaced.id, `saved id ${(await saved()).id}, replacement ${replaced.id}`);
  await panelClick('復原上一個平面圖'); await settle();
  check('restore works again with the same backup', (await saved()).id === fresh.id && same(await backup(), edited));

  // 2a. A focused field with a typed value that is not committed yet is committed before the backup.
  await select2d('sample-f2');
  const f2 = at(await saved(), 'sample-f2');
  await xField().fill(String(f2[0] + 400));
  const focus = await panelClick('新增空白平面圖'); await settle();
  check('pending field: the field had focus when the replacement started', focus.activeTag === 'INPUT' && focus.activeType === 'number', JSON.stringify(focus));
  check('pending field: the backup has the typed value', at(await backup(), 'sample-f2')?.[0] === f2[0] + 400, `backup cx ${at(await backup(), 'sample-f2')?.[0]}, expected ${f2[0] + 400}`);
  const empty = await saved();
  check('new empty plan: no walls, rooms or furniture', empty.walls.length === 0 && empty.rooms.length === 0 && empty.furniture.length === 0 && empty.id !== fresh.id);
  const emptyFit = await fitMatches(empty);
  check('new empty plan: the view fits the default empty area', emptyFit.ok, emptyFit.detail);

  // 2b. A 2D furniture drag in progress is cancelled: the backup has the position from before the drag.
  await panelClick('復原上一個平面圖'); await settle();
  const beforeDrag = await saved(), f3 = at(beforeDrag, 'sample-f3');
  const box = await page.locator('[data-furniture-id="sample-f3"]').boundingBox();
  const steps2 = await undoSteps();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 + 16 * i, box.y + box.height / 2 + 10 * i);
  await panelClick('載入範例公寓');
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 90); await page.mouse.up(); await settle();
  const afterDrag = await saved();
  check('2D drag: the backup has the position from before the drag', same(at(await backup(), 'sample-f3'), f3), `${at(await backup(), 'sample-f3')} vs ${f3}`);
  check('2D drag: the pointer release does not move anything in the new plan', same(at(afterDrag, 'sample-f3'), at(fresh, 'sample-f3')) && afterDrag.id !== beforeDrag.id);
  check('2D drag: only the replacement is in the undo history', await undoSteps() === steps2 + 1, `${steps2} → ${await undoSteps()}`);

  // 2c. A 3D drag in progress is cancelled. The new sample has the same furniture IDs, so the drag must not continue into it.
  await page.getByRole('button', { name: '3D 檢視' }).first().click();
  await page.waitForSelector('[aria-label="3D floor-plan view"] canvas');
  await page.locator('.three-toolbar select').selectOption('low');
  await page.waitForTimeout(1500);
  const plan3d = await saved(), canvas = page.locator('[aria-label="3D floor-plan view"] canvas'), cb = await canvas.boundingBox();
  // Screen points from the default camera for a plan. The gestures start on the item under the bed's centre point (the
  // pick decides which item), so all furniture is compared.
  let screenAt, bed, bx, by;
  const aim = plan => {
    const frame = createViewFrame(plan), pose = cameraPose(frame, 45, cb.width / cb.height);
    const cam = new THREE.PerspectiveCamera(45, cb.width / cb.height, 0.05, pose.far);
    cam.position.set(...pose.position); cam.lookAt(...pose.target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    screenAt = (x, y) => { const v = new THREE.Vector3(toSceneX(frame, x), 0, toSceneZ(frame, y)).project(cam); return [cb.x + (v.x + 1) / 2 * cb.width, cb.y + (1 - v.y) / 2 * cb.height]; };
    bed = at(plan, 'sample-f1'); [bx, by] = screenAt(...bed);
  };
  aim(plan3d);
  const positions = plan => plan.furniture.map(f => [f.id, f.cx, f.cy]);
  // The release is a synthetic pointerup sent in the same browser task as the replacement click (if any), so it reaches
  // the 3D view before React can render the new plan there. This is the order that a slow frame rate allows.
  const release3d = (clickName, [x, y]) => page.evaluate(([n, x, y]) => {
    if (n) [...document.querySelectorAll('#settings-sidebar button')].find(b => b.textContent.trim() === n).click();
    document.querySelector('[aria-label="3D floor-plan view"] canvas').dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true }));
  }, [clickName, x, y]);
  const gesture3d = async clickName => {
    await page.mouse.click(bx, by); await page.waitForTimeout(300);
    await page.mouse.move(bx, by); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { const [x, y] = screenAt(bed[0] - 250 * i, bed[1] + 250 * i); await page.mouse.move(x, y); }
    await release3d(clickName, screenAt(bed[0] - 1500, bed[1] + 1500));
    await page.mouse.up(); await settle();
  };
  // Control: with no replacement, the same gesture and synthetic release move an item. Then undo it.
  await gesture3d(null);
  const control = await saved();
  check('3D drag control: the gesture moves an item when nothing is replaced', control.id === plan3d.id && !same(positions(control), positions(plan3d)));
  await page.getByRole('button', { name: '復原', exact: true }).first().click(); await settle();
  check('3D drag control: undo puts it back', same(positions(await saved()), positions(plan3d)));
  const steps3 = await undoSteps();
  await gesture3d('載入範例公寓');
  const after3d = await saved();
  check('3D drag: the backup has every item where it was before the drag', same(positions(await backup()), positions(plan3d)));
  check('3D drag: the pointer release moves nothing in the new plan, which has the same item IDs', after3d.id !== plan3d.id && same(positions(after3d), positions(fresh)));
  check('3D drag: only the replacement is in the undo history', await undoSteps() === steps3 + 1, `${steps3} → ${await undoSteps()}`);
  // A replacement that the 3D view renders during the drag ends the drag there. The new sample has the same item IDs,
  // so a drag that went on would leave that model at the pointer while the data keeps it in place. "Reset view" redraws
  // every model from the data, so the canvas must not change when it is clicked.
  await page.mouse.click(bx, by); await page.waitForTimeout(300);
  await page.mouse.move(bx, by); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { const [x, y] = screenAt(bed[0] - 250 * i, bed[1] + 250 * i); await page.mouse.move(x, y); }
  await panelClick('載入範例公寓'); await page.waitForTimeout(500);
  { const [x, y] = screenAt(bed[0] - 1800, bed[1] + 1800); await page.mouse.move(x, y); }
  await page.mouse.up(); await settle();
  await page.mouse.move(1439, 899); await page.waitForTimeout(1500);
  const afterRelease = await canvas.screenshot();
  await page.getByRole('button', { name: '重設視角' }).click(); await page.mouse.move(1439, 899); await page.waitForTimeout(1500);
  check('3D drag: after the release, every model is where the new plan has it (canvas unchanged by "Reset view")', afterRelease.equals(await canvas.screenshot()));

  // 2d. Same-ID restore: restoring the backup while it is already open keeps the plan ID, so the plan ID cannot be what
  // ends a drag. Both release orders are checked, as above.
  await panelClick('復原上一個平面圖'); await settle(); await page.waitForTimeout(1000);
  const planB = await saved(); aim(planB);
  await gesture3d(null);
  check('same-ID restore control: the gesture moves an item', !same(positions(await saved()), positions(planB)));
  await page.getByRole('button', { name: '復原', exact: true }).first().click(); await settle();
  const stepsB = await undoSteps();
  await gesture3d('復原上一個平面圖');
  const afterB = await saved();
  check('same-ID restore: the plan ID does not change', afterB.id === planB.id);
  check('same-ID restore, release before the 3D view renders: every item is where the restored plan has it', same(positions(afterB), positions(planB)),
    afterB.furniture.filter(f => !same([f.cx, f.cy], at(planB, f.id))).map(f => `${f.id} ${at(planB, f.id)} → ${f.cx},${f.cy}`).join('; '));
  check('same-ID restore: only the restore is in the undo history', await undoSteps() === stepsB + 1, `${stepsB} → ${await undoSteps()}`);
  await page.mouse.click(bx, by); await page.waitForTimeout(300);
  await page.mouse.move(bx, by); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { const [x, y] = screenAt(bed[0] - 250 * i, bed[1] + 250 * i); await page.mouse.move(x, y); }
  await panelClick('復原上一個平面圖'); await page.waitForTimeout(500);
  { const [x, y] = screenAt(bed[0] - 1800, bed[1] + 1800); await page.mouse.move(x, y); }
  await page.mouse.up(); await settle();
  check('same-ID restore, release after the 3D view renders: every item is where the restored plan has it', same(positions(await saved()), positions(planB)));
  await page.mouse.move(1439, 899); await page.waitForTimeout(1500);
  const afterRestoreRelease = await canvas.screenshot();
  await page.getByRole('button', { name: '重設視角' }).click(); await page.mouse.move(1439, 899); await page.waitForTimeout(1500);
  check('same-ID restore: every model is where the restored plan has it (canvas unchanged by "Reset view")', afterRestoreRelease.equals(await canvas.screenshot()));
  await page.getByRole('button', { name: '2D 平面圖' }).first().click();
  await page.waitForSelector('svg.plan-svg');

  // 5. The replacement clears the selection and fits the new plan, also after a zoom.
  await select2d('sample-f4');
  check('selection: an item is selected before the replacement', (await page.locator('.inspector h3').count()) === 1);
  await page.locator('svg.plan-svg').dispatchEvent('wheel', { deltaY: -400, clientX: 700, clientY: 400 }); await page.waitForTimeout(200);
  await panelClick('載入範例公寓'); await settle();
  check('selection: cleared by the replacement', await noSelection());
  const sampleFit = await fitMatches(await saved());
  check('fit: the zoomed view is replaced by the fit of the new plan', sampleFit.ok, sampleFit.detail);

  // 3. A failed backup (storage full) changes nothing and offers a download of the current plan.
  const beforeFail = await read(KEY), backupBeforeFail = await read(BACKUP), steps4 = await undoSteps();
  await page.evaluate(k => {
    const original = Storage.prototype.setItem;
    window.restoreSetItem = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key === k) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, BACKUP);
  await panelClick('新增空白平面圖'); await settle();
  const notice = page.locator('[data-replace-notice][role=alert]');
  check('failed backup: an error is shown', (await notice.count()) === 1 && (await notice.innerText()).includes('無法備份'));
  check('failed backup: the plan is not replaced', (await read(KEY)) === beforeFail);
  check('failed backup: the undo history is unchanged', await undoSteps() === steps4, `${steps4} → ${await undoSteps()}`);
  check('failed backup: the earlier backup is unchanged', (await read(BACKUP)) === backupBeforeFail);
  const [download] = await Promise.all([page.waitForEvent('download'), notice.getByRole('button', { name: '下載目前平面圖' }).click()]);
  const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
  check('failed backup: the download is the current plan', same(downloaded, JSON.parse(beforeFail)));
  await page.evaluate(() => window.restoreSetItem());

  // 6. The H2 recovery copy is never written by replacement or restore.
  check('H2: the recovery copy is unchanged after all replacements', (await read(RECOVERY)) === H2_SENTINEL);
  const unreadable = '{"schemaVersion":2,"broken":';
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, unreadable]);
  await page.reload(); await page.waitForSelector('svg.plan-svg'); await settle();
  check('H2: a load error makes the recovery copy', (await read(RECOVERY)) === unreadable && (await page.locator('[role=status]').first().innerText()).includes('無法載入'));
  await page.getByRole('button', { name: 'Open Plan 專案設定' }).click();
  await panelClick('載入範例公寓'); await settle();
  await panelClick('復原上一個平面圖'); await settle();
  check('H2: replacement and restore keep the recovery copy and the unreadable save', (await read(RECOVERY)) === unreadable && (await read(KEY)) === unreadable);

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

// Browser check for roadmap B3: the first plan, import (file input, buttons, drag-and-drop), the summary and error
// dialog, v1 files, the export and import round trip, the agent prompt, and the B1 replacement through import.
// Usage: node tools/checks/import.mjs <url> [image-dir]   Exit code 0 means every check passed.
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fitBounds, summarizePlan, validatePlan } from '../../packages/core/dist/index.js';
import { openSample } from './sample-plan.mjs';

const [url, imageDir] = process.argv.slice(2);
if (!url) { console.error('Usage: node tools/checks/import.mjs <url> [image-dir]'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'open-plan:document:v1', BACKUP = 'open-plan:document:v1:replaced', RECOVERY = 'open-plan:document:v1:recovery';
if (imageDir) await mkdir(imageDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = (plan, id) => plan?.furniture.find(x => x.id === id)?.cx;

// The example of the published format description: the file an agent is told to copy.
const formatDoc = await readFile(new URL('../../docs/plan-format.md', import.meta.url), 'utf8');
const exampleText = /```json\n([\s\S]*?)```/.exec(formatDoc)[1];
const example = JSON.parse(exampleText);
const v1Sample = await readFile(new URL('../../packages/core/test/fixtures/sample-v1.json', import.meta.url), 'utf8');
const file = (name, text) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const read = key => page.evaluate(k => localStorage.getItem(k), key);
  const saved = async () => JSON.parse(await read(KEY));
  const settle = () => page.waitForTimeout(700);                       // longer than the 400 ms autosave delay
  const load = async entries => {
    await page.evaluate(e => { localStorage.clear(); for (const [k, v] of e) localStorage.setItem(k, v); }, entries);
    await page.reload(); await page.waitForSelector('svg.plan-svg'); await settle();
  };
  const dialog = page.locator('[role=dialog]');
  const importFile = async f => { await page.locator('[data-import-input]').setInputFiles(f); await dialog.waitFor(); };
  const confirm = async () => { await dialog.getByRole('button', { name: '取代目前平面圖' }).click(); await settle(); };
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const clearClipboard = () => page.evaluate(() => navigator.clipboard.writeText(''));
  // The header button toggles the panel, so it is clicked only when the plan panel is hidden.
  const openPanel = async () => { if (!(await page.locator('[data-agent-prompt]').isVisible())) await page.getByRole('button', { name: 'Open Plan 專案設定' }).click(); };
  const viewBox = async () => (await page.locator('svg.plan-svg').getAttribute('viewBox')).split(' ').map(Number);
  const fitMatches = async plan => {
    const v = await viewBox();
    const { w, h } = await page.evaluate(() => { const s = document.querySelector('svg.plan-svg'); return { w: s.clientWidth, h: s.clientHeight }; });
    const [x0, y0, x1, y1] = fitBounds(plan), scale = Math.min(w / (x1 - x0), h / (y1 - y0)), ew = w / scale, eh = h / scale;
    const expected = [(x0 + x1) / 2 - ew / 2, (y0 + y1) / 2 - eh / 2, ew, eh];
    return v.every((n, i) => Math.abs(n - expected[i]) < 1e-6);
  };
  await page.goto(url);

  // 1. First plan: a new user sees an empty plan with the import and sample actions; a returning user sees their plan.
  await load([]);
  const empty = page.locator('[data-empty-plan]');
  check('first plan: a new user gets an empty plan', (await saved()).walls.length === 0 && (await saved()).furniture.length === 0);
  check('first plan: the empty plan shows 匯入平面圖, 載入範例公寓 and 複製 AI 提示',
    (await empty.getByRole('button', { name: '匯入平面圖' }).count()) === 1 && (await empty.getByRole('button', { name: '載入範例公寓' }).count()) === 1 &&
    (await empty.getByRole('button', { name: '複製 AI 提示' }).count()) === 1);
  if (imageDir) await page.screenshot({ path: join(imageDir, 'first-plan.png') });
  await clearClipboard();
  await empty.getByRole('button', { name: '複製 AI 提示' }).click();
  const prompt = await clipboard();
  check('agent prompt: the empty plan copies the prompt with the format description and its example', prompt.includes(formatDoc.trim()) && prompt.includes(exampleText.trim()), `${prompt.length} characters`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), empty.getByRole('button', { name: '匯入平面圖' }).click()]);
  await chooser.setFiles(file('example.json', exampleText)); await dialog.waitFor();
  check('first plan: 匯入平面圖 opens the file chooser and the import dialog', (await dialog.getAttribute('data-import-dialog')) === 'ok');
  await page.keyboard.press('Escape');
  check('dialog: Escape closes it, and the plan does not change', (await dialog.count()) === 0 && (await saved()).walls.length === 0 && (await read(BACKUP)) === null);
  const sample = await openSample(page); await settle();
  check('returning user: the saved plan opens, with no empty-plan actions', (await empty.count()) === 0 && same(await saved(), sample));

  // 2. Import of a valid v2 file: the summary, then the replacement through B1 (backup, undo, fit).
  const [headerChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '匯入平面圖' }).first().click()]);
  await headerChooser.setFiles(file('example.json', exampleText)); await dialog.waitFor();
  const summary = summarizePlan(validatePlan(example, 'import').plan);
  const summaryText = await page.locator('[data-import-summary]').innerText();
  check('summary: the counts and the size in metres', ['1 段', '4 個', '1 個', '0 件', `${summary.width.toFixed(2)} m × ${summary.depth.toFixed(2)} m`].every(t => summaryText.includes(t)), summaryText.replace(/\s+/g, ' '));
  check('summary: the dialog says the current plan is backed up first', (await dialog.innerText()).includes('取代前會先備份目前的平面圖'));
  if (imageDir) await page.screenshot({ path: join(imageDir, 'import-summary.png') });
  await dialog.getByRole('button', { name: '取消' }).click();
  check('cancel: the plan does not change and there is no backup', (await dialog.count()) === 0 && same(await saved(), sample) && (await read(BACKUP)) === null);
  await importFile(file('example.json', exampleText)); await confirm();
  const imported = await saved();
  check('import: the saved plan is the file, normalized', same(imported, validatePlan(example, 'import').plan) && imported.id === 'example');
  check('import: the previous plan is in the backup', same(JSON.parse(await read(BACKUP)), sample));
  check('import: the notice names the file', (await page.locator('[data-replace-notice]').innerText()).includes('已匯入「example.json」'));
  check('import: the 2D view fits the new plan', await fitMatches(imported));
  check('import: the H2 recovery copy is not written', (await read(RECOVERY)) === null);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await settle();
  check('import: one undo brings the previous plan back', same(await saved(), sample));

  // 3. Round trip: an exported plan imports again with no change, and the view fits it again although the id is the same.
  await page.getByRole('button', { name: '放大' }).click(); await page.getByRole('button', { name: '放大' }).click();
  check('round trip: before the import, the view is zoomed in (not the fit)', !(await fitMatches(sample)));
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '匯出 JSON' }).click()]);
  const exportedText = await readFile(await download.path(), 'utf8');
  await importFile(await download.path()); await confirm();
  check('round trip: export then import gives the same plan', same(await saved(), sample) && same(JSON.parse(exportedText), sample));
  check('round trip: the same plan id still fits the view again', await fitMatches(sample));
  // In 3D: zoom the camera, import the same file again, and the default camera of the plan is back.
  const canvas = page.locator('[aria-label="3D floor-plan view"] canvas');
  // The replacement notice lies over the canvas; it is closed, so only the model is compared.
  const shot3d = async () => {
    if (await page.locator('[data-replace-notice]').count()) await page.getByRole('button', { name: '關閉通知' }).click();
    await page.mouse.move(1439, 899); await page.waitForTimeout(2500); return canvas.screenshot();
  };
  await page.getByRole('button', { name: '3D 檢視' }).first().click();
  await canvas.waitFor(); await page.locator('.three-toolbar select').selectOption('full');
  const defaultCamera = await shot3d();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(150); }
  const zoomed = await shot3d();
  await importFile(await download.path()); await confirm();
  const again = await shot3d();
  if (imageDir) for (const [n, png] of [['3d-default', defaultCamera], ['3d-zoomed', zoomed], ['3d-imported-again', again]]) await writeFile(join(imageDir, `${n}.png`), png);
  check('round trip 3D: the zoom changed the view', !zoomed.equals(defaultCamera));
  check('round trip 3D: the same plan id imported again resets the 3D camera', again.equals(defaultCamera));
  check('round trip 3D: no error overlay', (await page.locator('.three-error').count()) === 0);
  await page.getByRole('button', { name: '2D 平面圖' }).first().click();

  // 4. A v1 file is migrated with the A1 rules, and the dialog shows the migration report.
  await importFile(file('sample-v1.json', v1Sample));
  const report = await page.locator('[data-import-report]').innerText();
  check('v1: the dialog shows the migration report', /24 項說明/.test(report) && report.includes('已在開口位置建立一段牆 · 22 項'), report.split('\n').slice(0, 3).join(' / '));
  if (imageDir) await page.screenshot({ path: join(imageDir, 'import-v1.png') });
  await confirm();
  const migrated = await saved();
  check('v1: the imported plan is schema version 2 with the sample content', migrated.schemaVersion === 2 && migrated.walls.length === 70 && migrated.furniture.length === 46);

  // 5. Errors: the import policy is strict, the first 20 are listed with the count, and the list can be copied.
  const before = await read(KEY);
  const many = { ...example, furniture: Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, type: 'sofa', name: 'x', cx: 0, cy: 0, w: 0, d: 500, rot: 0 })) };
  await importFile(file('many.json', JSON.stringify(many)));
  const lines = await page.locator('[data-import-errors] li').allInnerTexts();
  check('errors: 20 are listed, then the count', (await dialog.getAttribute('data-import-dialog')) === 'error' && lines.length === 21 && lines[20] === '還有 5 個未列出（共 25 個）', `${lines.length} lines`);
  check('errors: there is no replace button', (await dialog.getByRole('button', { name: '取代目前平面圖' }).count()) === 0);
  await clearClipboard();
  await dialog.getByRole('button', { name: '複製錯誤訊息' }).click();
  const copied = (await clipboard()).split('\n');
  check('errors: the copy has all 25 errors, each with its path', copied.length === 25 && copied[24].endsWith('（furniture[24].w）'), copied.at(-1));
  if (imageDir) await page.screenshot({ path: join(imageDir, 'import-errors.png') });
  await dialog.getByRole('button', { name: '關閉' }).first().click();
  const tolerable = { ...example, openings: [...example.openings, { id: 'win2', type: 'window', wallId: 'w1', offset: 1000, width: 600 }] };
  await importFile(file('overlap.json', JSON.stringify(tolerable)));
  check('errors: a tolerable issue (overlapping openings) is an error on import', (await page.locator('[data-import-errors] li').allInnerTexts()).some(l => l.includes('重疊') && l.endsWith('（openings[4]）')));
  await page.keyboard.press('Escape');
  await importFile(file('broken.json', '{"schemaVersion": 2,'));
  check('errors: a file that is not JSON gets one clear message', (await page.locator('[data-import-errors] li').allInnerTexts()).join() === '平面圖：資料不是有效的 JSON（$）');
  await page.keyboard.press('Escape');
  await importFile({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(21 * 1024 * 1024, 32) });
  check('errors: a file over 20 MB is refused without reading it', (await page.locator('[data-import-errors] li').allInnerTexts()).join().includes('大於 20 MB'));
  await page.keyboard.press('Escape');
  check('errors: the plan did not change', (await read(KEY)) === before);

  // 6. Drag-and-drop of a file on the workspace: the overlay while over it, then the same dialog.
  const drag = async (type, text) => page.evaluate(([t, body]) => {
    const data = new DataTransfer();
    data.items.add(new File([body], 'dropped.json', { type: 'application/json' }));
    document.querySelector('.workspace-root').dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: data }));
  }, [type, text]);
  await drag('dragenter', exampleText);
  const overlayShown = await page.locator('[data-drop-overlay]').waitFor({ timeout: 2000 }).then(() => true, () => false);
  check('drop: the overlay shows while a file is over the workspace', overlayShown);
  await drag('drop', exampleText); await dialog.waitFor();
  check('drop: the overlay goes, and the import dialog opens with the summary', (await page.locator('[data-drop-overlay]').count()) === 0 && (await dialog.innerText()).includes('dropped.json'));
  await confirm();
  check('drop: the dropped plan replaces the current one', (await saved()).id === 'example');

  // 7. An edit less than 400 ms old is in the backup: the edit, the drop and the confirmation in one task sequence.
  await openSample(page); await settle();
  await page.locator('[data-furniture-id="sample-f1"]').click();
  const xField = page.locator('.inspector label').filter({ hasText: /^X/ }).locator('input');
  await xField.fill('8000'); await xField.press('Enter');
  const savedAtConfirm = await page.evaluate(async ([k, body]) => {
    const data = new DataTransfer();
    data.items.add(new File([body], 'quick.json', { type: 'application/json' }));
    document.querySelector('.workspace-root').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    const button = await new Promise(done => { const find = () => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.trim() === '取代目前平面圖'); b ? done(b) : requestAnimationFrame(find); }; find(); });
    const cx = JSON.parse(localStorage.getItem(k)).furniture.find(f => f.id === 'sample-f1').cx;
    button.click();
    return cx;
  }, [KEY, exampleText]);
  await settle();
  check('fast edit: not yet autosaved when the import was confirmed', savedAtConfirm === 8300, `saved cx ${savedAtConfirm}`);
  check('fast edit: the backup has the edit', at(JSON.parse(await read(BACKUP)), 'sample-f1') === 8000);
  check('fast edit: the import replaced the plan', (await saved()).id === 'example');

  // 8. Migrate, save, reload: a v1 plan with a tolerable issue shows the same warning both times; a blocking one does not open.
  const v1Tolerable = JSON.parse(v1Sample); v1Tolerable.rooms[0].mat = 'granite';
  const warnings = async () => { await openPanel(); return page.locator('[data-plan-warnings] li').allInnerTexts(); };
  await load([[KEY, JSON.stringify(v1Tolerable)]]);
  const first = await warnings();
  check('v1 tolerable: the stored plan is migrated and saved as version 2', (await saved()).schemaVersion === 2);
  await page.reload(); await page.waitForSelector('svg.plan-svg'); await settle();
  const second = await warnings();
  check('v1 tolerable: the same warning before and after the reload', first.length === 1 && same(first, second), first.join());
  const v1Blocking = JSON.parse(v1Sample); v1Blocking.furniture[0].w = 0;
  const blockingRaw = JSON.stringify(v1Blocking);
  await load([[KEY, blockingRaw]]);
  check('v1 blocking: the plan does not open', (await page.locator('[role=status]').first().innerText()).includes('無法載入'));
  check('v1 blocking: the data is in the recovery copy and not overwritten', (await read(RECOVERY)) === blockingRaw && (await read(KEY)) === blockingRaw);

  // 9. Keyboard: the dialog is modal. Focus starts in it, Tab and Shift+Tab stay in it, the background cannot take focus
  // or act, Escape closes it, and focus goes back to the control that opened it.
  await openSample(page); await settle(); await openPanel();
  const sampleNow = await read(KEY);
  const focusInDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
  const importButton = page.getByRole('button', { name: '匯入平面圖' }).first();
  await importButton.focus();
  const focusedLabel = () => page.evaluate(() => { const a = document.activeElement; return a?.getAttribute('aria-label') || a?.tagName || 'none'; });
  const focusBefore = await focusedLabel();
  const keyChooser = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.keyboard.press('Enter')]).then(([c]) => c, () => null);
  check('keyboard: Enter on the focused 匯入 button opens the file chooser', !!keyChooser, `focus before Enter: ${focusBefore}, after: ${await focusedLabel()}`);
  if (!keyChooser) throw new Error('no file chooser; the keyboard steps cannot continue');
  await keyChooser.setFiles(file('example.json', exampleText)); await dialog.waitFor();
  check('keyboard: focus starts in the dialog', await focusInDialog());
  let staysIn = true;
  for (const key of [...Array(8).fill('Tab'), ...Array(8).fill('Shift+Tab')]) { await page.keyboard.press(key); staysIn &&= await focusInDialog(); }
  check('keyboard: Tab and Shift+Tab never leave the dialog', staysIn);
  check('keyboard: the header, the workspace and the cost panel are inert', await page.evaluate(() => ['header', 'main'].every(s => document.querySelector(s).inert)));
  const backgroundFocus = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#settings-sidebar button')].find(x => x.textContent.trim() === '載入範例公寓');
    b.focus(); return document.activeElement === b;
  });
  check('keyboard: 載入範例公寓 behind the dialog cannot take focus', !backgroundFocus && await focusInDialog());
  await page.locator('#settings-sidebar').getByRole('button', { name: '載入範例公寓' }).click({ force: true, timeout: 2000 }).catch(() => {});
  await settle();
  check('keyboard: a click behind the dialog does nothing', (await read(KEY)) === sampleNow && (await dialog.count()) === 1);
  await page.keyboard.press('Escape');
  check('keyboard: Escape closes the dialog and the plan does not change', (await dialog.count()) === 0 && (await read(KEY)) === sampleNow);
  check('keyboard: focus goes back to the 匯入 button', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '匯入平面圖'));
  const [keyChooser2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  await keyChooser2.setFiles(file('example.json', exampleText)); await dialog.waitFor();
  await page.keyboard.press('Enter'); await settle();
  check('keyboard: Enter on the first focused button replaces the plan', (await saved()).id === 'example' && (await dialog.count()) === 0);

  // 10. Delayed reads: only the newest file may show its result. A slow read that ends after a newer file, after
  // 取消 or after 取代目前平面圖 is ignored, also when it fails.
  await openSample(page); await settle();
  await page.evaluate(() => {
    const text = File.prototype.text;
    File.prototype.text = function () {
      if (!this.name.startsWith('slow')) return text.call(this);
      return new Promise((done, fail) => setTimeout(() => (this.name.includes('fail') ? fail(new Error('slow read failed')) : done(text.call(this))), 800));
    };
  });
  const dropNamed = names => page.evaluate(([list, slowBody, fastBody]) => {
    for (const name of list) {
      const data = new DataTransfer();
      data.items.add(new File([name.startsWith('slow') ? slowBody : fastBody], name, { type: 'application/json' }));
      document.querySelector('.workspace-root').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    }
  }, [names, JSON.stringify({ ...example, id: 'slow', name: 'Slow plan' }), exampleText]);
  const beforeSlow = await read(KEY);
  await dropNamed(['slow.json', 'fast.json']); await dialog.waitFor(); await page.waitForTimeout(1200);
  check('slow read: the newer file stays in the preview after the older read ends', (await dialog.innerText()).includes('fast.json') && !(await dialog.innerText()).includes('Slow plan'));
  await page.keyboard.press('Escape');
  // The slow file is dropped while the preview of a fast one is open, so only 取消 or 取代目前平面圖 can end its read.
  await dropNamed(['fast.json']); await dialog.waitFor(); await dropNamed(['slow.json']); await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  check('slow read: after 取消, a pending read opens no dialog', (await dialog.count()) === 0 && (await read(KEY)) === beforeSlow);
  await dropNamed(['fast.json']); await dialog.waitFor(); await dropNamed(['slow.json']); await confirm(); await page.waitForTimeout(1200);
  check('slow read: after 取代目前平面圖, a pending read opens no dialog and does not replace', (await dialog.count()) === 0 && (await saved()).id === 'example');
  await dropNamed(['slow-fail.json', 'fast.json']); await dialog.waitFor(); await page.waitForTimeout(1200);
  check('slow read: a failed older read does not replace the newer preview with an error', (await dialog.getAttribute('data-import-dialog')) === 'ok' && (await dialog.innerText()).includes('fast.json'));
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('svg.plan-svg');

  // 11. The agent prompt card in the plan panel: the prompt, its copy button, and the privacy text.
  await openPanel();
  const card = page.locator('[data-agent-prompt]');
  await clearClipboard();
  await card.getByRole('button', { name: '複製 AI 提示' }).click();
  check('agent prompt: the panel copies the same prompt that it shows', (await clipboard()) === prompt && (await card.locator('textarea').inputValue()) === prompt);
  check('agent prompt: the privacy text is beside it', (await card.locator('[data-privacy]').innerText()).includes('Open Plan 不會上傳你的圖片或平面圖'));
  if (imageDir) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(imageDir, 'agent-prompt.png') }); }

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

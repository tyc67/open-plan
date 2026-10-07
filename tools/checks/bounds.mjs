// Browser check for roadmap A3: plan bounds, 2D fit, 3D frame, empty and furniture-only plans, and frame rate.
// Usage: node tools/checks/bounds.mjs <url> [image-dir]   Exit code 0 means every check passed.
// With an image dir, it saves the 2D and 3D images of every test plan for review, and a frame-rate record.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import * as THREE from '../../apps/web/node_modules/three/build/three.module.js';
import { cameraPose, contentBounds, createViewFrame, toSceneX, toSceneZ } from '../../packages/core/dist/index.js';
import { openSample } from './sample-plan.mjs';

const [url, imageDir] = process.argv.slice(2);
if (!url) { console.error('Usage: node tools/checks/bounds.mjs <url> [image-dir]'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'open-plan:document:v1', VIEWPORT = { width: 1440, height: 900 };
if (imageDir) await mkdir(imageDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

/** Moves every coordinate of a v2 plan by (dx, dy). */
function translate(plan, dx, dy) {
  const p = structuredClone(plan);
  p.id = `${plan.id}-moved`;
  for (const w of p.walls) { w.a = [w.a[0] + dx, w.a[1] + dy]; w.b = [w.b[0] + dx, w.b[1] + dy]; }
  for (const r of p.rooms) { r.poly = r.poly.map(([x, y]) => [x + dx, y + dy]); if (r.at) r.at = [r.at[0] + dx, r.at[1] + dy]; }
  for (const f of p.furniture) { f.cx += dx; f.cy += dy; }
  for (const m of p.measurements ?? []) { m.a = { x: m.a.x + dx, y: m.a.y + dy }; m.b = { x: m.b.x + dx, y: m.b.y + dy }; }
  for (const c of p.dimensions ?? []) { c.at += c.horizontal ? dy : dx; c.start += c.horizontal ? dx : dy; }
  return p;
}

/** A plan of width × depth metres: a perimeter wall, inner walls every `grid` metres, one door, one room. */
function gridPlan(id, width, depth, grid, materials) {
  const W = width * 1000, D = depth * 1000, t = 200, walls = [
    { id: 'n', type: 'e', a: [0, 0], b: [W, 0], thickness: t }, { id: 's', type: 'e', a: [0, D], b: [W, D], thickness: t },
    { id: 'w', type: 'e', a: [0, 0], b: [0, D], thickness: t }, { id: 'e', type: 'e', a: [W, 0], b: [W, D], thickness: t },
  ];
  if (grid) {
    for (let x = grid * 1000; x < W; x += grid * 1000) walls.push({ id: `x${x}`, type: 'n', a: [x, 0], b: [x, D], thickness: 120 });
    for (let y = grid * 1000; y < D; y += grid * 1000) walls.push({ id: `y${y}`, type: 'n', a: [0, y], b: [W, y], thickness: 120 });
  }
  return {
    schemaVersion: 2, id, name: id, units: 'mm', locale: 'zh-TW', ceilingHeight: 2800, walls,
    openings: [{ id: 'd', type: 'door', wallId: 's', offset: Math.min(1000, W / 3), width: 900, hinge: 'start', swing: 'left', head: 2100 }],
    rooms: [{ id: 'r', name: '房間', mat: 'wood', poly: [[100, 100], [W - 100, 100], [W - 100, D - 100], [100, D - 100]], at: [W / 2, D / 2] }],
    materials, furniture: [], measurements: [], dimensions: [],
  };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  const sample = await openSample(page);

  const load = async plan => {
    await page.evaluate(([k, s]) => { localStorage.clear(); localStorage.setItem(k, s); }, [KEY, JSON.stringify(plan)]);
    await page.reload();
    await page.waitForSelector('svg.plan-svg');
    await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
  };
  const canvasBox = { x: 384, y: 64, width: 692, height: 800 };
  const shot2d = () => page.screenshot({ clip: canvasBox, animations: 'disabled', caret: 'hide' });
  const open3d = async (level = 'full') => {
    await page.getByRole('button', { name: '3D 檢視' }).first().click();
    await page.waitForSelector('[aria-label="3D floor-plan view"] canvas');
    await page.locator('.three-toolbar select').selectOption(level);
    await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
    await page.waitForTimeout(3000);
  };
  const shot3d = () => page.screenshot({ clip: canvasBox, animations: 'disabled', caret: 'hide' });
  const close3d = async () => { await page.getByRole('button', { name: '2D 平面圖' }).first().click(); await page.waitForSelector('svg.plan-svg'); };
  const viewBox = async () => (await page.locator('svg.plan-svg').getAttribute('viewBox')).split(' ').map(Number);
  // Screen box of every element in the 2D drawing, in document order. Empty elements (size 0, such as an empty
  // group) are left out: they draw nothing, and Chrome reports their user-space origin as the position.
  const boxes2d = () => page.evaluate(() => [...document.querySelectorAll('svg.plan-svg *')].map(e => { const r = e.getBoundingClientRect(); return [e.tagName, r.x, r.y, r.width, r.height]; }).filter(b => b[3] || b[4]));
  const changedPixels = (a, b) => { const A = PNG.sync.read(a), B = PNG.sync.read(b); let n = 0; for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) n++; return [n, A.width * A.height]; };
  const save = async (name, png) => { if (imageDir) await writeFile(join(imageDir, `${name}.png`), png); };
  const fps = async () => page.evaluate(() => new Promise(done => { let n = 0; const start = performance.now(); const tick = () => { n++; if (performance.now() - start < 5000) requestAnimationFrame(tick); else done(n / ((performance.now() - start) / 1000)); }; requestAnimationFrame(tick); }));

  // 1. Translation: the same plan moved by (+20000, +20000) mm looks the same, and snapping still works.
  await load(sample);
  const sample2d = await shot2d(); await save('sample-2d', sample2d); const sampleBoxes = await boxes2d();
  await open3d('low'); const sampleLow = await shot3d(); await save('sample-3d-cut-0.9', sampleLow);
  await open3d('full'); const sampleFull = await shot3d(); await save('sample-3d-cut-2.8', sampleFull);
  const sampleFps = await fps(); await close3d();
  const moved = translate(sample, 20000, 20000);
  await load(moved);
  const moved2d = await shot2d(); await save('moved-2d', moved2d);
  // 2D: the geometry must be the same to 0.01 px. The pixels are not byte-identical: Chrome rounds glyph and edge
  // positions at the sub-pixel level from the absolute coordinates, so a few anti-aliased pixels change.
  const movedBoxes = await boxes2d();
  const worst = movedBoxes.length === sampleBoxes.length ? Math.max(0, ...movedBoxes.flatMap((b, i) => b[0] === sampleBoxes[i][0] ? b.slice(1).map((v, k) => Math.abs(v - sampleBoxes[i][k + 1])) : [Infinity])) : Infinity;
  check('moved plan: 2D element screen boxes are the same (0.01 px)', worst <= 0.01, `${movedBoxes.length} elements, largest difference ${worst.toFixed(4)} px`);
  const [changed, total] = changedPixels(sample2d, moved2d);
  check('moved plan: 2D pixels differ only by sub-pixel anti-aliasing (at most 0.25%)', changed / total <= 0.0025, `${changed} of ${total} pixels, ${(100 * changed / total).toFixed(3)}%`);
  await open3d('low'); const movedLow = await shot3d(); await save('moved-3d-cut-0.9', movedLow);
  check('moved plan: 3D (cut 0.9 m) is pixel-identical', movedLow.equals(sampleLow));
  await open3d('full'); const movedFull = await shot3d(); await save('moved-3d-cut-2.8', movedFull);
  check('moved plan: 3D (full height) is pixel-identical', movedFull.equals(sampleFull));
  await close3d();

  // Snapping in the moved plan: drag a 90° item to the wall at x = 20000 (the sample's x = 0 wall, moved).
  const snapPlan = structuredClone(moved);
  snapPlan.furniture = [{ id: 'snap', type: 'sofa', name: '測試', cx: 20250, cy: 25790, w: 800, d: 420, rot: 90, color: '#888888' }];
  await load(snapPlan);
  const item = page.locator('g.furniture').first(), b = await item.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 1, b.y + b.height / 2); await page.mouse.move(b.x + b.width / 2 - 2, b.y + b.height / 2); await page.mouse.up();
  await page.waitForTimeout(500);
  const snapped = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY)).furniture[0];
  check('moved plan: 2D drag snaps flush to the moved wall', snapped.cx === 20210, `cx ${snapped.cx}, expected 20210`);

  // The same snap with a 3D canvas drag, which goes through the frame's scene-to-plan conversion. Screen points come
  // from the default camera (core cameraPose, 45° field of view, the canvas aspect), the same as the viewer.
  // The drag runs on the moved plan and on the same plan at the original place; the results must differ by exactly
  // the translation. (3D has a larger snap tolerance than 2D, so y may also align to a nearby edge.)
  const canvas = page.locator('[aria-label="3D floor-plan view"] canvas');
  const frameOrigin = () => canvas.getAttribute('data-frame-origin');
  let frame, screenAt;
  const open3dFor = async plan => {
    await load(plan); await open3d('low');
    const cb = await canvas.boundingBox(), pose = cameraPose(frame = createViewFrame(plan), 45, cb.width / cb.height);
    const cam = new THREE.PerspectiveCamera(45, cb.width / cb.height, 0.05, pose.far);
    cam.position.set(...pose.position); cam.lookAt(...pose.target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    // Screen point of plan (x, y) on the floor. The ray to the floor under an item passes through the item first.
    screenAt = (x, y) => { const v = new THREE.Vector3(toSceneX(frame, x), 0, toSceneZ(frame, y)).project(cam); return [cb.x + (v.x + 1) / 2 * cb.width, cb.y + (1 - v.y) / 2 * cb.height]; };
  };
  const steps = 8;
  const drag3d = async (from, path) => {
    const [sx, sy] = screenAt(...from);
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (const [x0, y0, x1, y1] of path) for (let i = 1; i <= steps; i++) { const [x, y] = screenAt(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.mouse.move(x, y); }
    const during = await frameOrigin();
    await page.mouse.up(); await page.waitForTimeout(500);
    return during;
  };
  // 70 mm is only about 3 px, below the 4 px drag threshold: go 600 mm into the room first, then back to the
  // raw target x + 180, which is 30 mm into the snap range of the wall face.
  const snapIn3d = async (plan, d) => {
    await open3dFor(plan);
    const [sx, sy] = screenAt(250 + d, 5790 + d);
    await page.mouse.click(sx, sy); await page.waitForTimeout(300);                     // the first click selects
    const during = await drag3d([250 + d, 5790 + d], [[250 + d, 5790 + d, 850 + d, 5790 + d], [850 + d, 5790 + d, 180 + d, 5790 + d]]);
    return { during, item: JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY)).furniture[0] };
  };
  const original = await snapIn3d({ ...snapPlan, id: 'snap-original', walls: sample.walls, openings: sample.openings, rooms: sample.rooms, measurements: sample.measurements, dimensions: sample.dimensions,
    furniture: [{ ...snapPlan.furniture[0], cx: 250, cy: 5790 }] }, 0);
  const movedSnap = await snapIn3d(snapPlan, 20000), origin0 = await frameOrigin(), originDuring = movedSnap.during;
  check('3D frame origin is the centre of the physical bounds', origin0 === frame.origin.join(','), `${origin0}, expected ${frame.origin.join(',')}`);
  check('moved plan: 3D drag snaps flush to the moved wall, the same as the original plan', movedSnap.item.cx === 20210 && movedSnap.item.cx === original.item.cx + 20000 && movedSnap.item.cy === original.item.cy + 20000,
    `moved cx ${movedSnap.item.cx}, cy ${movedSnap.item.cy}; original cx ${original.item.cx}, cy ${original.item.cy}; expected cx 20210 and a difference of exactly 20000`);

  // The frame stays fixed during and after a drag, even when the drag changes the physical bounds.
  // Drag the item 6 m outside the walls (no snap target there), then check the frame; "Reset view" moves it.
  const { cx, cy } = movedSnap.item;
  const originDuringOut = await drag3d([cx, cy], [[cx, cy, cx - 6000, cy]]);
  const outside = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
  const originAfter = await frameOrigin();
  check('3D frame stays fixed during both drags and after the drop', originDuring === origin0 && originDuringOut === origin0 && originAfter === origin0,
    `before ${origin0}; during ${originDuring}, ${originDuringOut}; after ${originAfter}; item now at cx ${outside.furniture[0].cx}`);
  await page.getByRole('button', { name: '重設視角' }).click(); await page.waitForTimeout(300);
  const originReset = await frameOrigin(), expectedReset = createViewFrame(outside).origin.join(',');
  check('"Reset view" moves the frame to the new physical bounds', originReset === expectedReset && originReset !== origin0, `${originReset}, expected ${expectedReset}`);
  await close3d();

  // 2. Every plan fits in 2D (the view box contains all content) and opens in 3D with no error.
  const plans = [
    ['room-3x4', gridPlan('room-3x4', 3, 4, 0, sample.materials)],
    ['plan-30x20', gridPlan('plan-30x20', 30, 20, 5, sample.materials)],
    ['plan-100x100', gridPlan('plan-100x100', 100, 100, 10, sample.materials)],
    ['furniture-only', { ...gridPlan('furniture-only', 3, 3, 0, sample.materials), walls: [], openings: [], rooms: [], furniture: [
      { id: 'f1', type: 'sofa', name: '沙發', cx: 1000, cy: 1000, w: 2000, d: 900, rot: 0, color: '#9aa5b1' },
      { id: 'f2', type: 'table', name: '桌', cx: 4000, cy: 2500, w: 1200, d: 800, rot: 30, color: '#b08b5a' }] }],
    ['empty', { ...gridPlan('empty', 3, 3, 0, sample.materials), walls: [], openings: [], rooms: [] }],
  ];
  for (const [name, plan] of plans) {
    await load(plan);
    check(`${name}: loads with no error banner`, (await page.locator('[role=alert]').count()) === 0);
    const [vx, vy, vw, vh] = await viewBox(), c = contentBounds(plan);
    const fits = !c || (c[0] >= vx && c[1] >= vy && c[2] <= vx + vw && c[3] <= vy + vh);
    check(`${name}: 2D view box contains all content`, fits, `view ${[vx, vy, vw, vh].map(Math.round).join(', ')}; content ${c ? c.join(', ') : 'none'}`);
    await save(`${name}-2d`, await shot2d());
    if (name === 'plan-100x100') {
      // Zoom out must never zoom in, also when the fit scale is below the old fixed minimum scale.
      const before = await viewBox();
      await page.getByRole('button', { name: '縮小' }).first().click(); await page.waitForTimeout(200);
      const afterButton = await viewBox();
      await page.locator('svg.plan-svg').dispatchEvent('wheel', { deltaY: 400, clientX: 700, clientY: 400 }); await page.waitForTimeout(200);
      const afterWheel = await viewBox();
      check('plan-100x100: zoom out (button, then wheel) shows a larger area each time', afterButton[2] > before[2] && afterWheel[2] > afterButton[2],
        `view width ${Math.round(before[2])} → ${Math.round(afterButton[2])} → ${Math.round(afterWheel[2])} mm`);
      await page.getByRole('button', { name: '顯示整張平面圖' }).first().click(); await page.waitForTimeout(200);
    }
    await open3d('full');
    check(`${name}: 3D opens with no error overlay`, (await page.locator('.three-error').count()) === 0);
    await save(`${name}-3d`, await shot3d());
    if (name === 'plan-100x100') {
      const bigFps = await fps();
      const record = `Frame rate, headless Chrome ${browser.version()}, SwiftShader (software WebGL), 1440 × 900, device scale 1, full cut height, 5 s:\n  sample: ${sampleFps.toFixed(1)} fps\n  100 × 100 m plan: ${bigFps.toFixed(1)} fps\n`;
      console.log(record.trim());
      if (imageDir) await writeFile(join(imageDir, 'frame-rate.txt'), record);
    }
    await close3d();
  }

  // Dimension chains are optional: a plan with no `dimensions` field shows none (not the sample's chains).
  const chainCount = () => page.locator('g.dimension-chain').count();
  const noDimensions = gridPlan('no-dimensions', 6, 4, 0, sample.materials);
  delete noDimensions.dimensions;
  await load(noDimensions);
  check('a plan with no dimensions field shows no dimension lines', (await chainCount()) === 0 && (await page.locator('[role=alert]').count()) === 0, `${await chainCount()} chains`);
  await load(sample);
  check('the sample shows its own dimension chains', (await chainCount()) === sample.dimensions.length, `${await chainCount()} of ${sample.dimensions.length}`);

  // 3. Fit after zooming returns to the fit area, and editing does not change the fit zoom.
  await load(sample);
  const fitView = await viewBox();
  await page.locator('svg.plan-svg').dispatchEvent('wheel', { deltaY: -400, clientX: 700, clientY: 400 });
  await page.waitForTimeout(300);
  const zoomed = await viewBox();
  await page.getByRole('button', { name: '顯示整張平面圖' }).first().click();
  await page.waitForTimeout(300);
  check('fit returns to the fit area after zooming', JSON.stringify(await viewBox()) === JSON.stringify(fitView) && JSON.stringify(zoomed) !== JSON.stringify(fitView));

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

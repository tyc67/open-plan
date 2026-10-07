// Records the 3D shadows of a large plan for review (roadmap A3, "Large-plan shadows"). This is a record, not a test:
// it saves images and the conditions, and a person describes softness and artifacts from them.
// Usage: node tools/visual/shadows.mjs <url> <out-dir>
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import * as THREE from '../../apps/web/node_modules/three/build/three.module.js';
import { cameraPose, createViewFrame, shadowBox, toSceneX, toSceneZ } from '../../packages/core/dist/index.js';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) { console.error('Usage: node tools/visual/shadows.mjs <url> <out-dir>'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'open-plan:document:v1', SHADOW_MAP = 2048;
await mkdir(outDir, { recursive: true });

/** W × W mm: perimeter walls, partitions every `step` mm, one room over the whole area. */
function gridPlan(materials, W = 100_000, step = 10_000) {
  const walls = [
    { id: 'n', type: 'e', a: [0, 0], b: [W, 0], thickness: 200 }, { id: 's', type: 'e', a: [0, W], b: [W, W], thickness: 200 },
    { id: 'w', type: 'e', a: [0, 0], b: [0, W], thickness: 200 }, { id: 'e', type: 'e', a: [W, 0], b: [W, W], thickness: 200 },
  ];
  for (let v = step; v < W; v += step) walls.push({ id: `x${v}`, type: 'n', a: [v, 0], b: [v, W], thickness: 120 }, { id: `y${v}`, type: 'n', a: [0, v], b: [W, v], thickness: 120 });
  return { schemaVersion: 2, id: `shadow-${W / 1000}`, name: 'Shadow 100 m', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800, walls, openings: [],
    rooms: [{ id: 'r', name: '房間', mat: 'tile800', poly: [[100, 100], [W - 100, 100], [W - 100, W - 100], [100, W - 100]] }], materials, furniture: [], measurements: [], dimensions: [] };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const lines = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })).newPage();
  await page.goto(url);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('svg.plan-svg');
  await page.waitForTimeout(800);
  const sample = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
  const canvas = page.locator('[aria-label="3D floor-plan view"] canvas');
  const open = async plan => {
    await page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [KEY, JSON.stringify(plan)]);
    await page.reload(); await page.waitForSelector('svg.plan-svg');
    await page.getByRole('button', { name: '3D 檢視' }).first().click(); await page.waitForSelector('[aria-label="3D floor-plan view"] canvas');
    await page.locator('.three-toolbar select').selectOption('full'); await page.mouse.move(1439, 899); await page.waitForTimeout(3000);
  };
  const shot = async name => { await page.mouse.move(1439, 899); await page.waitForTimeout(2500); await writeFile(join(outDir, `${name}.png`), await canvas.screenshot()); };
  const box = async () => canvas.boundingBox();
  // Wheel steps toward the orbit target (the plan centre), the same for both plans.
  const zoomIn = async steps => { const b = await box(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(150); } };
  // Right-button drag pans the view (OrbitControls).
  const pan = async (dx, dy) => { const b = await box(), x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.move(x + dx, y + dy, { steps: 20 }); await page.mouse.up({ button: 'right' }); };

  for (const [name, plan] of [['sample', sample], ['plan-100x100', gridPlan(sample.materials)]]) {
    const shadow = shadowBox(createViewFrame(plan)), texel = 2 * shadow.half / SHADOW_MAP;
    lines.push(`${name}: shadow box ${(2 * shadow.half).toFixed(1)} m wide, ${SHADOW_MAP} px map, ${(texel * 1000).toFixed(1)} mm per shadow texel`);
    await open(plan); await shot(`${name}-default`);
    await zoomIn(8); await shot(`${name}-zoom-centre`);
  }
  // Shadow at the plan edge, measured at the default camera: ground brightness 0.7 m into the shadow that the east wall
  // (x = W) casts outside the plan, against open ground 2.5 m from the wall. A shadow box that is too small would show
  // no shadow there. The marked images (contrast-*.png) show the two points. Points inside the plan are not measured:
  // from this camera most wall shadows inside are hidden behind their walls.
  const brightness = (png, [px, py]) => { let sum = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = ((py + dy) * png.width + px + dx) * 4; sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]; } return sum / 25; };
  for (const W of [10_000, 100_000]) {
    // No room: the plain ground receives the shadows, so the tile texture of a floor does not add noise.
    const plan = { ...gridPlan(sample.materials, W, W / 2 >= 10_000 ? 10_000 : W / 2), rooms: [] };
    await open(plan); await page.mouse.move(1439, 899); await page.waitForTimeout(2500);
    const png = PNG.sync.read(await canvas.screenshot()), b = await box(), frame = createViewFrame(plan), pose = cameraPose(frame, 45, b.width / b.height);
    const cam = new THREE.PerspectiveCamera(45, b.width / b.height, 0.05, pose.far);
    cam.position.set(...pose.position); cam.lookAt(...pose.target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const px = (x, y) => { const v = new THREE.Vector3(toSceneX(frame, x), 0, toSceneZ(frame, y)).project(cam); return [Math.round((v.x + 1) / 2 * b.width * 2), Math.round((1 - v.y) / 2 * b.height * 2)]; };
    // A y between two walls that run along x: 2.5 m for the 10 m plan (walls at 0 and 5 m), 55 m for the 100 m plan.
    const y = W === 10_000 ? 2500 : 55_000;
    // Mark the sample points (red), and save the image, so the record can be checked by eye.
    const marked = PNG.sync.read(PNG.sync.write(png));
    for (const p of [[W + 700, y], [W + 2500, y]]) { const [mx, my] = px(...p); for (let t = -8; t <= 8; t++) for (const [qx, qy] of [[mx + t, my], [mx, my + t]]) { const i = (qy * marked.width + qx) * 4; marked.data[i] = 255; marked.data[i + 1] = 0; marked.data[i + 2] = 0; } }
    await writeFile(join(outDir, `contrast-${W / 1000}m.png`), PNG.sync.write(marked));
    const contrast = (shadow, open) => (brightness(png, px(...open)) - brightness(png, px(...shadow))).toFixed(1);
    lines.push(`${W / 1000} × ${W / 1000} m: shadow outside the east edge, open ground minus shadow ${contrast([W + 700, y], [W + 2500, y])} of 255 (brightness)`);
  }

  // The near corner of the 100 m plan (closest to the camera): zoom in, then pan the view toward it.
  await open(gridPlan(sample.materials));
  await zoomIn(8); for (let i = 1; i <= 3; i++) { await pan(0, -150); await shot(`plan-100x100-pan-near-${i}`); }
  lines.unshift(`Shadow record, headless Chrome ${browser.version()}, SwiftShader (software WebGL), 1440 × 900 at device scale 2, full cut height, PCFSoftShadowMap.`);
} finally {
  await browser.close();
}
await writeFile(join(outDir, 'shadows.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));

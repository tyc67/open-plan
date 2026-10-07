// Browser check for roadmap Step A, "Opening holes": one continuous wall with a window, a door, a sliding door and
// a hole shows four real gaps in 3D, with correct sill and lintel heights.
// Usage: node tools/checks/openings.mjs <url> [image-dir]   Exit code 0 means every check passed.
//
// Method: the plan is drawn twice from the same default camera at the full cut height, once with the openings and
// once as a solid wall. Points on the wall's front face are compared: a point 100 mm inside an opening (above its
// sill, below its head) must differ from the solid wall, and a point 100 mm outside it (below the sill, above the
// head, beside it) must be identical, because the wall is there. 100 mm is about 7 px at this camera distance.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import * as THREE from '../../apps/web/node_modules/three/build/three.module.js';
import { cameraPose, createViewFrame, toSceneX, toSceneZ } from '../../packages/core/dist/index.js';

const [url, imageDir] = process.argv.slice(2);
if (!url) { console.error('Usage: node tools/checks/openings.mjs <url> [image-dir]'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'open-plan:document:v1';
if (imageDir) await mkdir(imageDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

// One exterior wall along x at y = 5000 (front face at y = 5100, toward the default camera), ceiling 2800.
// The door hinges at its far end and swings away from the camera, so its open leaf is not seen through the gap.
// A room with a dark walnut floor lies behind the wall: through a real gap the camera sees that floor, which differs
// clearly from the white wall (the light ground in front is almost the colour of the wall). Rays through the gaps go
// back and to the left (about 1.5 m left and 2 m back at the window head), so the room extends 2.5 m left and 3 m back.
// It also moves the default camera, so the room is no larger than that; the images use device scale 2 for more detail.
const WALL_Y = 5000, FACE_Y = 5100;
const openings = [
  { id: 'win', type: 'window', wallId: 'w', offset: 600, width: 1400, sill: 900, head: 2400 },
  { id: 'door', type: 'door', wallId: 'w', offset: 2800, width: 1000, hinge: 'end', swing: 'left', head: 2100 },
  { id: 'slide', type: 'sliding-door', wallId: 'w', offset: 4800, width: 1600, head: 2100 },
  { id: 'hole', type: 'hole', wallId: 'w', offset: 7400, width: 1400, head: 2400 },
];
const plan = list => ({
  schemaVersion: 2, id: 'openings-check', name: 'Openings check', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
  walls: [{ id: 'w', type: 'e', a: [0, WALL_Y], b: [10_000, WALL_Y], thickness: 200 }],
  openings: list, rooms: [{ id: 'behind', name: '後方', mat: 'walnut', poly: [[-2500, 2000], [10_000, 2000], [10_000, WALL_Y - 100], [-2500, WALL_Y - 100]] }],
  materials: { walnut: { name: '胡桃木地板', sw: '#a57c56' } }, furniture: [], measurements: [], dimensions: [],
});

// Points to test: [label, x along the wall, height, inside an opening?]
const points = [];
for (const o of openings) {
  const x = o.offset + o.width / 2, bottom = o.type === 'window' ? o.sill : 0;
  // Near the floor, the camera sees the floor under the gap, not the room behind, so the low point of a door, sliding
  // door or hole is 600 mm up; the head points check the height.
  points.push([`${o.type}: inside, ${o.type === 'window' ? '100 mm above the sill' : '600 mm above the floor'}`, x, bottom + (o.type === 'window' ? 100 : 600), true]);
  points.push([`${o.type}: inside, 100 mm below the head`, x, o.head - 100, true]);
  points.push([`${o.type}: lintel, 100 mm above the head`, x, o.head + 100, false]);
  if (o.type === 'window') points.push(['window: wall, 100 mm below the sill', x, o.sill - 100, false]);
  points.push([`${o.type}: wall, 100 mm beside the opening`, o.offset - 100, 1200, false]);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  const canvas = page.locator('[aria-label="3D floor-plan view"] canvas');
  const render = async p => {
    await page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [KEY, JSON.stringify(p)]);
    await page.reload(); await page.waitForSelector('svg.plan-svg');
    await page.getByRole('button', { name: '3D 檢視' }).first().click();
    await page.waitForSelector('[aria-label="3D floor-plan view"] canvas');
    await page.locator('.three-toolbar select').selectOption('full');
    await page.mouse.move(1439, 899); await page.waitForTimeout(3000);
    return canvas.screenshot();
  };
  const withOpenings = await render(plan(openings)), solid = await render(plan([]));
  check('no 3D error overlay and no page errors', (await page.locator('.three-error').count()) === 0 && errors.length === 0, errors.join(' | '));
  if (imageDir) { await writeFile(join(imageDir, 'openings-3d.png'), withOpenings); await writeFile(join(imageDir, 'solid-3d.png'), solid); }

  // Screen point of a plan point (x, y) at a height in mm, from the default camera of the plan (core cameraPose, 45°).
  const box = await canvas.boundingBox(), frame = createViewFrame(plan(openings)), pose = cameraPose(frame, 45, box.width / box.height);
  const cam = new THREE.PerspectiveCamera(45, box.width / box.height, 0.05, pose.far);
  cam.position.set(...pose.position); cam.lookAt(...pose.target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const pixelAt = (x, y, h) => { const v = new THREE.Vector3(toSceneX(frame, x), h / 1000, toSceneZ(frame, y)).project(cam); return [Math.round((v.x + 1) / 2 * box.width * 2), Math.round((1 - v.y) / 2 * box.height * 2)]; };
  const [A, S] = [PNG.sync.read(withOpenings), PNG.sync.read(solid)];
  // Largest colour difference (0–255) between the two images in the 3 × 3 pixels around a point.
  const difference = ([px, py]) => {
    let max = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = ((py + dy) * A.width + px + dx) * 4;
      for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(A.data[i + k] - S.data[i + k]));
    }
    return max;
  };
  for (const [label, x, h, inside] of points) {
    const p = pixelAt(x, FACE_Y, h), d = difference(p);
    check(label, inside ? d >= 40 : d === 0, `pixel ${p}, difference ${d}${inside ? ', must be 40 or more' : ', must be 0'}`);
  }
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

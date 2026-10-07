// Captures fixed screenshots of the sample plan for regression compares.
// Usage: node tools/visual/capture.mjs <url> <out-dir>
// The same Chrome version must be used for the baseline and every compare (see meta.json).
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VIEWPORTS, SCENES, shotName } from './scenes.mjs';
import { openSample } from '../checks/sample-plan.mjs';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) { console.error('Usage: node tools/visual/capture.mjs <url> <out-dir>'); process.exit(2); }

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

await mkdir(outDir, { recursive: true });
// SwiftShader gives the same WebGL output on every run; GPU output can differ.
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none'] });
const shots = [];
try {
  for (const viewport of VIEWPORTS) for (const scene of SCENES) {
    const { view, level } = scene, name = shotName(viewport, scene);
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await openSample(page);
    if (view === '3d') {
      await page.getByRole('button', { name: '3D 檢視' }).first().click();
      await page.waitForSelector('[aria-label="3D floor-plan view"] canvas', { timeout: 30000 });
      await page.locator('.three-toolbar select').selectOption(level);
    }
    // Move the pointer off every control, so no hover state or tooltip is captured.
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await page.evaluate(() => document.fonts.ready);
    // Let OrbitControls damping settle and the render loop draw several frames.
    await page.waitForTimeout(view === '3d' ? 3000 : 500);
    await page.evaluate(() => new Promise(done => { let n = 0; const tick = () => (++n >= 10 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }));
    const file = `${name}.png`;
    await page.screenshot({ path: join(outDir, file), animations: 'disabled', caret: 'hide' });
    shots.push({ name, file, errors });
    if (errors.length) console.error(`${name}: page errors: ${errors.join(' | ')}`);
    await context.close();
  }
  await writeFile(join(outDir, 'meta.json'), JSON.stringify({ chrome: browser.version(), url, capturedAt: new Date().toISOString(), shots }, null, 2) + '\n');
  console.log(`Captured ${shots.length} screenshots with Chrome ${browser.version()} into ${outDir}`);
} finally {
  await browser.close();
}
if (shots.some(s => s.errors.length)) process.exit(1);

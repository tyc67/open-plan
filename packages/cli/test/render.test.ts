import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createEmptyPlan, createSamplePlan, fitBounds, renderPlanSvg, type PlanV2 } from 'open-plan-core';
import * as op from '../src/operations.js';
import { folder, read, run } from './helpers.js';

const REFERENCES = new URL('./references/', import.meta.url).pathname;
const FONTS = new URL('./fonts/', import.meta.url).pathname;
const TEST_FONT = { files: [join(FONTS, 'OpenPlanTestTC.ttf')], family: 'Open Plan Test TC' };

/**
 * Compares a PNG with a stored reference exactly: the same size and the same decoded RGBA bytes in every pixel. There is
 * no tolerance, also not for anti-aliasing. `UPDATE_REFERENCES=1` writes the reference instead. A failed compare writes
 * the image and a diff (every different pixel in red) next to the reference, for a person to look at.
 */
function expectReference(png: Buffer, name: string) {
  const path = join(REFERENCES, name);
  if (process.env.UPDATE_REFERENCES) { mkdirSync(REFERENCES, { recursive: true }); writeFileSync(path, png); }
  expect(differentPixels(png, readFileSync(path), path), `${name}: see ${path}.actual.png and .diff.png`).toBe(0);
}
function differentPixels(png: Buffer, referencePng: Buffer, keepAs?: string): number {
  const actual = PNG.sync.read(png), reference = PNG.sync.read(referencePng);
  if (actual.width !== reference.width || actual.height !== reference.height) { if (keepAs) writeFileSync(`${keepAs}.actual.png`, png); return Infinity; }
  const diff = new PNG({ width: actual.width, height: actual.height });
  let count = 0;
  for (let i = 0; i < actual.data.length; i += 4) {
    const same = actual.data.readUInt32BE(i) === reference.data.readUInt32BE(i);
    if (!same) count++;
    diff.data.writeUInt32BE(same ? 0xffffffff : 0xff0000ff, i);
  }
  if (count && keepAs) { writeFileSync(`${keepAs}.actual.png`, png); writeFileSync(`${keepAs}.diff.png`, PNG.sync.write(diff)); }
  return count;
}

/** A small two-room flat, as an agent might write it from an image: 6 × 4 m, a partition, a window and two doors. */
function loopPlan() {
  const e = (id: string, a: number[], b: number[]) => ({ id, type: 'e', a, b, thickness: 200 });
  return {
    ...createEmptyPlan('loop'), name: 'Loop test',
    walls: [e('w-n', [0, 0], [6000, 0]), e('w-e', [6000, 0], [6000, 4000]), e('w-s', [6000, 4000], [0, 4000]), e('w-w', [0, 4000], [0, 0]),
      { id: 'w-mid', type: 'n', a: [3000, 0], b: [3000, 4000], thickness: 100 }],
    openings: [
      { id: 'win-1', wallId: 'w-n', offset: 800, width: 1400, type: 'window', sill: 900, head: 2400 },
      { id: 'door-1', wallId: 'w-mid', offset: 1500, width: 900, type: 'door', hinge: 'start', swing: 'left', head: 2100 },
      { id: 'door-2', wallId: 'w-s', offset: 800, width: 1000, type: 'door', hinge: 'end', swing: 'right', head: 2100 },
    ],
    rooms: [
      { id: 'r-living', name: '客廳', poly: [[3000, 0], [6000, 0], [6000, 4000], [3000, 4000]], mat: 'wood' },
      { id: 'r-bed', name: '主臥室', poly: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], mat: 'carpet' },
    ],
    furniture: [{ id: 'f-bed', type: 'bed', name: 'Bed', cx: 1500, cy: 2900, w: 1500, d: 2000, rot: 0, color: '#c9d6df' }],
  };
}

describe('CLI loop (roadmap C2b): write, validate, correct, render', () => {
  it('a scripted agent corrects 3 errors from `validate --json`, and `render` matches the stored geometry reference', () => {
    const dir = folder(), file = join(dir, 'plan.json');
    // The agent's first try has three mistakes: a repeated wall id, a door on a wall name that does not exist, and a
    // floor material that the plan does not define.
    const first = loopPlan();
    first.walls[4] = { ...first.walls[4], id: 'w-n' };
    first.openings[1] = { ...first.openings[1], wallId: 'w-middle' };
    first.rooms[1] = { ...first.rooms[1], mat: 'granite' };
    writeFileSync(file, JSON.stringify(first, null, 2));

    const checked = run(dir, 'validate', 'plan.json');
    expect([checked.code, checked.json.code]).toEqual([1, 'VALIDATION_FAILED']);
    const found = checked.json.errors.map((e: { path: string; code: string }) => `${e.path} ${e.code}`).sort();
    expect(found).toEqual(['openings[1].wallId wall-missing', 'rooms[1].mat room-material-missing', 'walls[4].id id-duplicate']);

    // The agent corrects each error at its path, from the code, and writes the file again.
    const fixed = JSON.parse(read(file));
    for (const error of checked.json.errors) {
      if (error.code === 'id-duplicate') fixed.walls[4].id = 'w-mid';
      else if (error.code === 'wall-missing') fixed.openings[1].wallId = 'w-mid';
      else if (error.code === 'room-material-missing') fixed.rooms[1].mat = 'carpet';
    }
    writeFileSync(file, JSON.stringify(fixed, null, 2));
    expect(run(dir, 'validate', 'plan.json')).toMatchObject({ code: 0, json: { ok: true } });

    const rendered = run(dir, 'render', 'plan.json', 'plan.png', '--grid', '--no-text', '--width', '800');
    const [x0, y0, x1, y1] = fitBounds(fixed as PlanV2);
    expect([rendered.code, rendered.json.width, rendered.json.height, rendered.json.output]).toEqual([0, 800, Math.round(800 * (y1 - y0) / (x1 - x0)), join(dir, 'plan.png')]);
    expectReference(readFileSync(join(dir, 'plan.png')), 'loop.png');
  });
  it('the compare is strict enough: one channel of one pixel 1 step off, a wall 20 mm off, or a missing door does not match', async () => {
    const reference = readFileSync(join(REFERENCES, 'loop.png')), changed = PNG.sync.read(reference);
    changed.data[4 * (changed.width * 100 + 100) + 1] ^= 1;
    expect(differentPixels(PNG.sync.write(changed), reference)).toBe(1);
    const moved = loopPlan(); moved.walls[4] = { ...moved.walls[4], a: [3020, 0], b: [3020, 4000] };
    moved.rooms = moved.rooms.map(r => ({ ...r, poly: r.poly.map(([x, y]) => [x === 3000 ? 3020 : x, y]) }));
    const noDoor = loopPlan(); noDoor.openings.splice(2, 1);
    for (const plan of [moved, noDoor]) {
      const dir = folder();
      writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
      expect((await op.render(join(dir, 'plan.json'), join(dir, 'plan.png'), { grid: true, text: false, width: 800 })).ok).toBe(true);
      expect(differentPixels(readFileSync(join(dir, 'plan.png')), reference)).toBeGreaterThan(0);
    }
  });
  it('text: false draws no text even when a font with every label character is available', async () => {
    const dir = folder();
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(loopPlan()));
    expect((await op.render(join(dir, 'plan.json'), join(dir, 'plan.png'), { grid: true, text: false, width: 800, fonts: TEST_FONT })).ok).toBe(true);
    expect(differentPixels(readFileSync(join(dir, 'plan.png')), readFileSync(join(REFERENCES, 'loop.png')))).toBe(0);
    expect((await op.render(join(dir, 'plan.json'), join(dir, 'text.png'), { grid: true, width: 800, fonts: TEST_FONT })).ok).toBe(true);
    expect(differentPixels(readFileSync(join(dir, 'text.png')), readFileSync(join(REFERENCES, 'loop.png')))).toBeGreaterThan(100);
  });
});

describe('render', () => {
  it('CJK labels with a fixed test font match the stored reference (the font has every character of the sample text)', async () => {
    const svg = renderPlanSvg(createSamplePlan('s'), { dimensions: true });
    const used = new Set([...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].flatMap(m => [...m[1]]));
    const inFont = new Set(readFileSync(join(FONTS, 'characters.txt'), 'utf8').replace(/\n$/, ''));
    expect([...used].filter(c => !inFont.has(c))).toEqual([]);

    const dir = folder();
    run(dir, 'new', 'plan.json', '--sample');
    const r = await op.render(join(dir, 'plan.json'), join(dir, 'plan.png'), { width: 900, dimensions: true, fonts: TEST_FONT });
    expect(r.ok).toBe(true);
    expectReference(readFileSync(join(dir, 'plan.png')), 'sample-cjk.png');
  });
  it('--crop and --width set the area and the size; render takes no lock and changes no plan or backup', () => {
    const dir = folder();
    run(dir, 'new', 'plan.json', '--sample');
    const before = read(join(dir, 'plan.json'));
    const r = run(dir, 'render', 'plan.json', 'part.png', '--crop', '0,0,4000,2000', '--width', '400', '--no-text');
    expect([r.code, r.json.width, r.json.height]).toEqual([0, 400, 200]);
    const png = PNG.sync.read(readFileSync(join(dir, 'part.png')));
    expect([png.width, png.height]).toEqual([400, 200]);
    expect([read(join(dir, 'plan.json')), readdirSync(dir).sort()]).toEqual([before, ['part.png', 'plan.json']]);
  });
  it('--crop takes a value that starts with a minus sign, with or without =', () => {
    const dir = folder();
    run(dir, 'new', 'plan.json', '--sample');
    for (const crop of [['--crop', '-500,-500,4000,2000'], ['--crop=-500,-500,4000,2000']]) {
      expect(run(dir, 'render', 'plan.json', 'neg.png', ...crop, '--width', '450', '--no-text'), crop.join(' ')).toMatchObject({ code: 0, json: { ok: true, width: 450, height: 250 } });
    }
    // Only a crop value is joined: another option after --crop is still an option, and the crop is missing.
    expect(run(dir, 'render', 'plan.json', 'x.png', '--crop', '--no-text').code).toBe(2);
  });
  it('draws a plan with tolerable issues and lists them; refuses a plan with errors that block rendering, and writes nothing', () => {
    const dir = folder(), plan = loopPlan();
    writeFileSync(join(dir, 'tolerable.json'), JSON.stringify({ ...plan, rooms: [{ ...plan.rooms[0], mat: 'granite' }] }));
    const drawn = run(dir, 'render', 'tolerable.json', 'a.png', '--no-text');
    expect([drawn.code, drawn.json.warnings.map((w: { code: string }) => w.code)]).toEqual([0, ['room-material-missing']]);
    writeFileSync(join(dir, 'blocking.json'), JSON.stringify({ ...plan, openings: [{ ...plan.openings[0], wallId: 'none' }] }));
    const refused = run(dir, 'render', 'blocking.json', 'b.png');
    expect([refused.code, refused.json.code, refused.json.errors[0].code, existsSync(join(dir, 'b.png'))]).toEqual([1, 'VALIDATION_FAILED', 'wall-missing', false]);
  });
  it('wrong render options, and the plan file as the output, are usage errors (exit 2); render options belong to render only', () => {
    const dir = folder();
    run(dir, 'new', 'plan.json');
    for (const options of [['--crop', '0,0,10'], ['--crop', '10,0,0,10'], ['--crop', 'a,b,c,d'], ['--width', '0'], ['--width', '1.5'], ['--width', '9000'], ['--width', '']]) {
      expect(run(dir, 'render', 'plan.json', 'x.png', ...options)).toMatchObject({ code: 2, json: { code: 'USAGE' } });
    }
    expect(run(dir, 'render', 'plan.json', 'plan.json')).toMatchObject({ code: 2, json: { code: 'USAGE' } });
    // The height follows the crop: a narrow crop with an allowed width is refused before anything is drawn.
    expect(run(dir, 'render', 'plan.json', 'x.png', '--crop', '0,0,1,100000', '--width', '100')).toMatchObject({ code: 2, json: { code: 'USAGE', width: 100, height: 10_000_000 } });
    expect(run(dir, 'render', 'plan.json', 'x.png', '--crop', '0,0,1,9000', '--width', '1')).toMatchObject({ code: 2, json: { code: 'USAGE', width: 1, height: 9000 } });
    expect(run(dir, 'render', 'plan.json', 'x.png', '--crop', '0,0,1e-300,1', '--width', '1')).toMatchObject({ code: 2, json: { code: 'USAGE' } });
    expect(run(dir, 'render', 'plan.json', 'x.png', '--crop', '0,0,8000,5000', '--width', '8000')).toMatchObject({ code: 2, json: { code: 'USAGE', width: 8000, height: 5000 } });
    expect(JSON.parse(read(join(dir, 'plan.json'))).schemaVersion).toBe(2);
    expect(run(dir, 'validate', 'plan.json', '--grid').code).toBe(2);
    expect(readdirSync(dir)).toEqual(['plan.json']);
  });
});

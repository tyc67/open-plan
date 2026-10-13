import { describe, expect, it } from 'vitest';
import { createSamplePlan, fitBounds, planGeometry, renderPlanSvg, roomLabelPoint, containsPoint } from '../src/index.js';

const sample = createSamplePlan('s');
const count = (svg: string, pattern: RegExp) => (svg.match(pattern) ?? []).length;

describe('2D SVG drawing (roadmap C1)', () => {
  it('draws every room, solid wall part, visible opening and furniture item of the sample', () => {
    const svg = renderPlanSvg(sample), geometry = planGeometry(sample);
    expect(count(svg, /<polygon data-room=/g)).toBe(sample.rooms.length);
    expect(count(svg, /data-wall=/g)).toBe(geometry.solids.length);
    expect(count(svg, /data-opening=/g)).toBe(geometry.openings.length);
    expect(count(svg, /data-type="door"/g)).toBe(6);
    expect(count(svg, /data-furniture=/g)).toBe(sample.furniture.length);
    for (const room of sample.rooms) expect(svg).toContain(`>${room.name}</text>`);
  });
  it('is the same text for the same plan and options', () => {
    expect(renderPlanSvg(createSamplePlan('a'), { grid: true, dimensions: true })).toBe(renderPlanSvg(createSamplePlan('b'), { grid: true, dimensions: true }));
  });
  it('uses the fit area by default, or the crop; the height follows the width', () => {
    const [x0, y0, x1, y1] = fitBounds(sample);
    expect(renderPlanSvg(sample)).toContain(`viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="1200" height="${Math.round(1200 * (y1 - y0) / (x1 - x0))}"`);
    expect(renderPlanSvg(sample, { crop: [0, 0, 4000, 2000], width: 800 })).toContain('viewBox="0 0 4000 2000" width="800" height="400"');
  });
  it('has the grid and dimensions only when asked; labels and furniture can be left out', () => {
    const plain = renderPlanSvg(sample), full = renderPlanSvg(sample, { grid: true, dimensions: true });
    expect([plain.includes('data-layer="grid"'), plain.includes('data-layer="dimensions"')]).toEqual([false, false]);
    expect([full.includes('data-layer="grid"'), full.includes('data-layer="dimensions"')]).toEqual([true, true]);
    const bare = renderPlanSvg(sample, { labels: false, furniture: false });
    expect([bare.includes('data-layer="labels"'), bare.includes('data-layer="furniture"')]).toEqual([false, false]);
  });
  it('text: false removes every text element and keeps everything else, also the dimension lines', () => {
    const options = { grid: true, dimensions: true }, full = renderPlanSvg(sample, options), bare = renderPlanSvg(sample, { ...options, text: false });
    expect([count(full, /<text /g) > 0, count(bare, /<text /g), bare.includes('data-layer="labels"')]).toEqual([true, 0, false]);
    const withoutText = full.replace(/<text [^>]*>[^<]*<\/text>/g, '').replace(/\n<g data-layer="labels"[^\n]*<\/g>/, '');
    expect(bare).toBe(withoutText);
    expect(count(bare, /<line /g)).toBe(count(full, /<line /g));
  });
  it('draws a demolished wall dashed, and escapes text', () => {
    const plan = { ...sample, walls: sample.walls.map(w => w.type === 'n' ? { ...w, demolished: true } : w), rooms: [{ ...sample.rooms[0], name: 'A <B> & "C"' }] };
    const svg = renderPlanSvg(plan);
    expect(svg).toMatch(/data-wall="[^"]+" fill="none" stroke="#d64545"/);
    expect(svg).toContain('>A &lt;B&gt; &amp; &quot;C&quot;</text>');
  });
  it('draws an empty plan', () => {
    const svg = renderPlanSvg({ ...sample, walls: [], openings: [], rooms: [], furniture: [] });
    expect(svg.startsWith('<svg') && svg.endsWith('</svg>')).toBe(true);
  });
});

describe('opening symbols follow their wall', () => {
  // Windows and sliding doors narrower than, as wide as, and wider than the 200 mm wall, in a horizontal and a vertical wall.
  const widths = [60, 200, 300];
  const plan = {
    ...sample, rooms: [], furniture: [], dimensions: [],
    walls: [{ id: 'h', type: 'n' as const, a: [0, 0] as [number, number], b: [4000, 0] as [number, number], thickness: 200 }, { id: 'v', type: 'n' as const, a: [5000, 0] as [number, number], b: [5000, 4000] as [number, number], thickness: 200 }],
    openings: ['h', 'v'].flatMap(wallId => widths.flatMap((width, i) => [
      { id: `${wallId}-win-${width}`, type: 'window' as const, wallId, offset: 200 + i * 1200, width, sill: 900, head: 2400 },
      { id: `${wallId}-slide-${width}`, type: 'sliding-door' as const, wallId, offset: 800 + i * 1200, width, head: 2100 },
    ])),
  };
  const svg = renderPlanSvg(plan);
  const lines = (id: string) => [...new RegExp(`<g data-opening="${id}"[^>]*>(.*?)</g>`).exec(svg)![1].matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)].map(m => m.slice(1).map(Number));
  for (const wallId of ['h', 'v']) for (const width of widths) {
    const horizontal = wallId === 'h', opening = plan.openings.find(o => o.id === `${wallId}-slide-${width}`)!;
    it(`${horizontal ? 'horizontal' : 'vertical'} wall, ${width} mm: the window line runs along the wall`, () => {
      const [[x1, y1, x2, y2]] = lines(`${wallId}-win-${width}`);
      expect(horizontal ? [y1 === y2, Math.abs(x2 - x1)] : [x1 === x2, Math.abs(y2 - y1)]).toEqual([true, width]);
    });
    it(`${horizontal ? 'horizontal' : 'vertical'} wall, ${width} mm: both sliding panels run along the wall and stay inside the opening`, () => {
      const panels = lines(`${wallId}-slide-${width}`), start = horizontal ? opening.offset : opening.offset, end = start + width;
      expect(panels).toHaveLength(2);
      for (const [x1, y1, x2, y2] of panels) {
        const [a, b, across1, across2] = horizontal ? [x1, x2, y1, y2] : [y1, y2, x1, x2];
        expect(across1).toBe(across2);
        expect(Math.min(a, b)).toBeGreaterThanOrEqual(start);
        expect(Math.max(a, b)).toBeLessThanOrEqual(end);
      }
    });
  }
});

describe('optional room label positions', () => {
  it('uses the same interior point in SVG, keeps explicit positions, and does not add at', () => {
    const room = { ...sample.rooms[0], poly: [[0, 0], [4000, 0], [4000, 1000], [1000, 1000], [1000, 4000], [0, 4000]] as [number, number][] };
    delete room.at;
    const before = JSON.stringify(room), at = roomLabelPoint(room);
    expect(at).toEqual([2000, 500]);
    expect(containsPoint(room.poly, ...at)).toBe(true);
    expect(renderPlanSvg({ ...sample, rooms: [room] })).toContain('x="2000" y="500"');
    expect(JSON.stringify(room)).toBe(before);
    expect(roomLabelPoint({ ...room, at: [50, 80] })).toEqual([50, 80]);
    expect(roomLabelPoint({ poly: [[0, 0], [10, 0], [20, 0]] })).toEqual([0, 0]);
    expect(roomLabelPoint({ poly: [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 1500]] })).toEqual([2000, 1500]);
    const thin ={ ...room, poly: [[0, 0], [0.1, 0], [0.1, 100000], [0, 100000]] as [number, number][] };
    expect(renderPlanSvg({ ...sample, rooms: [thin] })).toContain('x="0.05" y="50000"');
  });
});

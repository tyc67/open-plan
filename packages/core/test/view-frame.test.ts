import { describe, expect, it } from 'vitest';
import { cameraPose, createViewFrame, frameCorners, groundSize, migrateV1, shadowBox, toPlanX, toPlanY, toSceneX, toSceneZ } from '../src/index.js';
import type { PlanV1, PlanV2, Vec3, ViewFrame } from '../src/index.js';
import sampleJson from './fixtures/sample-v1.json' with { type: 'json' };

const sample = (): PlanV2 => migrateV1(JSON.parse(JSON.stringify(sampleJson)) as PlanV1).plan;
const box = (width: number, depth: number, height = 2.8): ViewFrame => ({ origin: [0, 0], width, depth, height });
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Projects a point with a look-at camera (up = +y), like three.js: returns normalized device x and y. */
function project(p: Vec3, eye: Vec3, target: Vec3, fovDeg: number, aspect: number): [number, number] {
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), d = sub(p, eye);
  const z = dot(d, f), t = Math.tan(fovDeg * Math.PI / 360);
  return [dot(d, r) / (z * t * aspect), dot(d, u) / (z * t)];
}

const SIZES: [string, ViewFrame][] = [['3 × 4 m room', box(3, 4)], ['sample', createViewFrame(sample())], ['30 × 20 m', box(30, 20)], ['100 × 100 m', box(100, 100)], ['tall 6 m ceiling', box(10, 8, 6)]];

describe('view frame', () => {
  it('centres the sample on its physical bounds', () => {
    const f = createViewFrame(sample());
    expect(f.origin).toEqual([5925, 5280]);
    expect([f.width, f.depth, f.height]).toEqual([12.33, 11.04, 2.8]);
  });
  it('round-trips plan and scene coordinates', () => {
    const f = { ...createViewFrame(sample()), origin: [12345.6, -987.5] as [number, number] };
    for (const v of [0, 1, -1, 5925, 12090, -240, 123456.7, 0.1]) {
      expect(toPlanX(f, toSceneX(f, v))).toBeCloseTo(v, 9);
      expect(toPlanY(f, toSceneZ(f, v))).toBeCloseTo(v, 9);
    }
    expect(toSceneX(f, 12345.6)).toBe(0);
    expect(toSceneZ(f, -987.5)).toBe(0);
  });
  it('gives the same scene coordinates for a moved plan', () => {
    const f = createViewFrame(sample()), moved = { ...f, origin: [f.origin[0] + 20000, f.origin[1] + 20000] as [number, number] };
    for (const v of [-240, 0, 5925, 12090]) {
      expect(toSceneX(moved, v + 20000)).toBe(toSceneX(f, v));
      expect(toSceneZ(moved, v + 20000)).toBe(toSceneZ(f, v));
    }
  });
});

describe('default camera fits the whole plan', () => {
  for (const [name, frame] of SIZES) for (const aspect of [0.5, 692 / 836, 1, 16 / 9]) {
    it(`${name}, aspect ${aspect.toFixed(2)}`, () => {
      const pose = cameraPose(frame, 45, aspect);
      for (const c of frameCorners(frame)) {
        const [x, y] = project(c, pose.position, pose.target, 45, aspect);
        expect(Math.abs(x)).toBeLessThanOrEqual(1);
        expect(Math.abs(y)).toBeLessThanOrEqual(1);
      }
      expect(pose.maxDistance).toBeGreaterThanOrEqual(Math.hypot(...pose.position));
      expect(pose.far).toBeGreaterThan(Math.hypot(...pose.position) + Math.max(frame.width, frame.depth));
    });
  }
});

describe('shadow box covers the whole plan', () => {
  for (const [name, frame] of SIZES) it(name, () => {
    const s = shadowBox(frame), f = norm(sub([0, 0, 0], s.sunPosition)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
    for (const c of frameCorners(frame)) {
      const d = sub(c, s.sunPosition);
      expect(Math.abs(dot(d, r))).toBeLessThan(s.half);
      expect(Math.abs(dot(d, u))).toBeLessThan(s.half);
      expect(dot(d, f)).toBeGreaterThan(s.near);
      expect(dot(d, f)).toBeLessThan(s.far);
    }
    expect(groundSize(frame)).toBeGreaterThanOrEqual(Math.max(frame.width, frame.depth));
  });
});

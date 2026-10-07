import { EMPTY_PLAN_AREA, physicalBounds } from './bounds.js';
import { effectiveCeilingHeight } from './heights.js';
import type { PlanV2 } from './types.js';

export type Vec3 = [number, number, number];

/**
 * The 3D coordinate frame for a plan. Plan (x, y) in mm maps to scene (x, z) in metres around `origin`,
 * the centre of the physical bounds. Set it when a plan is loaded or the view is reset, never during a gesture.
 */
export interface ViewFrame {
  /** Plan point (mm) at the scene origin. */
  origin: [number, number];
  /** Physical size in metres: width (x), depth (plan y) and the effective ceiling height. */
  width: number;
  depth: number;
  height: number;
}

export function createViewFrame(plan: PlanV2): ViewFrame {
  const [x0, y0, x1, y1] = physicalBounds(plan) ?? EMPTY_PLAN_AREA;
  return { origin: [(x0 + x1) / 2, (y0 + y1) / 2], width: (x1 - x0) / 1000, depth: (y1 - y0) / 1000, height: effectiveCeilingHeight(plan) / 1000 };
}

export const toSceneX = (frame: ViewFrame, x: number): number => (x - frame.origin[0]) / 1000;
export const toSceneZ = (frame: ViewFrame, y: number): number => (y - frame.origin[1]) / 1000;
export const toPlanX = (frame: ViewFrame, sx: number): number => sx * 1000 + frame.origin[0];
export const toPlanY = (frame: ViewFrame, sz: number): number => sz * 1000 + frame.origin[1];

/** The 8 corners of the plan's box in the scene: floor to ceiling, around the origin. */
export function frameCorners(frame: ViewFrame): Vec3[] {
  const hw = frame.width / 2, hd = frame.depth / 2, corners: Vec3[] = [];
  for (const x of [-hw, hw]) for (const y of [0, frame.height]) for (const z of [-hd, hd]) corners.push([x, y, z]);
  return corners;
}

const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3) => scale(v, 1 / length(v));

/** Direction from the target to the default camera, the same view angle as before (10, 16, 13). */
export const CAMERA_DIRECTION: Vec3 = unit([10, 16, 13]);

export interface CameraPose { position: Vec3; target: Vec3; maxDistance: number; far: number }

/**
 * Default camera that shows the whole plan: the box's bounding sphere (around the floor centre, which is the
 * orbit target) fits inside the narrower field of view. `fovDeg` is the vertical field of view, `aspect` width / height.
 */
export function cameraPose(frame: ViewFrame, fovDeg: number, aspect: number): CameraPose {
  const radius = Math.max(...frameCorners(frame).map(length));
  const vertical = fovDeg * Math.PI / 180, horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2);
  return { position: scale(CAMERA_DIRECTION, distance), target: [0, 0, 0], maxDistance: Math.max(60, distance * 2), far: Math.max(300, (distance + radius) * 2) };
}

/** Direction from the target to the sun, the same angle as before (-8, 16, 10). */
export const SUN_DIRECTION: Vec3 = unit([-8, 16, 10]);

export interface ShadowBox { sunPosition: Vec3; half: number; near: number; far: number }

/**
 * Sun position and orthographic shadow box that cover every corner of the plan's box, with a 0.5 m margin.
 * Light space uses the same up vector as three.js (0, 1, 0), so the box matches the shadow camera.
 */
export function shadowBox(frame: ViewFrame): ShadowBox {
  const corners = frameCorners(frame), radius = Math.max(...corners.map(length));
  const distance = radius + 10, sunPosition = scale(SUN_DIRECTION, distance);
  const forward = scale(SUN_DIRECTION, -1), right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
  const half = Math.max(...corners.flatMap(c => [Math.abs(dot(c, right)), Math.abs(dot(c, up))])) + 0.5;
  return { sunPosition, half, near: 1, far: distance + radius + 1 };
}

/** Ground plane size in metres: at least 100 m, and 3 times the larger plan side. */
export const groundSize = (frame: ViewFrame): number => Math.max(100, 3 * Math.max(frame.width, frame.depth));

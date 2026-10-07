import { toPlanX, toPlanY, toSceneX, toSceneZ } from 'open-plan-core';

// Document (x, y) in mm maps to Three.js (x, z) in metres around the frame origin (core createViewFrame).
// Only one 3D viewer exists at a time, and it sets the frame when a plan is loaded or the view is reset,
// never during a gesture; models and the viewer read it through these functions.
let frame = { origin: [0, 0], width: 10, depth: 8, height: 2.8 };
export const setFrame = next => { frame = next; };
export const wx = x => toSceneX(frame, x);
export const wz = y => toSceneZ(frame, y);
export const planX = sx => toPlanX(frame, sx);
export const planY = sz => toPlanY(frame, sz);
export const mm = value => value / 1000;

import { migrateV1, validateSharedFields } from 'open-plan-core';
import { createId } from './ids.js';
import { REFERENCE_DIMENSIONS } from './dimensions.js';
import { WALLS, WINS, DOORS, SLIDES, ROOMS, MATS, defaultFurniture } from './seed.js';

/** Document coordinates and dimensions are millimetres. UI state is stored separately. */
// The sample is defined in the v1 shape (seed.js) and migrated, so there is one source for its geometry.
export function createDocument() {
  return migrateV1(createDocumentV1()).plan;
}
/** A plan with no content. It keeps the sample's floor materials, so rooms added later have materials to use. */
export function createEmptyDocument() {
  return {
    schemaVersion: 2, id: createId(), name: '未命名平面圖', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
    walls: [], openings: [], rooms: [], materials: structuredClone(MATS), furniture: [], measurements: [], dimensions: [],
  };
}
function createDocumentV1() {
  return {
    schemaVersion: 1, id: createId(), name: 'Apartment plan', units: 'mm', locale: 'zh-TW',
    walls: WALLS.map(([x0,y0,x1,y1,type],i) => ({id:`wall-${i}`,rect:[x0,y0,x1,y1],type})),
    openings: [
      ...WINS.map((rect,i) => ({id:`window-${i}`,type:'window',rect})),
      ...DOORS.map((door,i) => ({...door,id:`door-${i}`,type:'door'})),
      ...SLIDES.map((door,i) => ({...door,id:`slide-${i}`,type:'sliding-door'})),
    ],
    rooms: structuredClone(ROOMS), materials: structuredClone(MATS),
    furniture: defaultFurniture(), measurements: [], dimensions: structuredClone(REFERENCE_DIMENSIONS),
  };
}
const finite = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
/**
 * A saved plan from before schema v2, checked before it is migrated: the v1 walls and openings here, the shared fields
 * with the core validator (saved policy). The migrated plan is then checked in full. Returns { ok, errors }.
 */
export function validateDocumentV1(doc) {
  const issue = (path, code, params = {}) => ({ ok: false, errors: [{ path, code, params }] });
  if (!isObject(doc) || doc.units !== 'mm') return issue('units', 'enum-invalid', { allowed: ['mm'], value: doc?.units });
  if (!Array.isArray(doc.walls)) return issue('walls', 'type-invalid', { expected: 'list' });
  if (!Array.isArray(doc.openings)) return issue('openings', 'type-invalid', { expected: 'list' });
  const badWall = doc.walls.findIndex(w => !(isObject(w) && typeof w.id === 'string' && typeof w.type === 'string' && finite(w.rect, 4)));
  if (badWall >= 0) return issue(`walls[${badWall}]`, 'v1-unreadable', { reason: 'wall' });
  const badOpening = doc.openings.findIndex(o => !(isObject(o) && typeof o.id === 'string' && typeof o.type === 'string' && finite(o.rect, 4) &&
    (o.type !== 'door' || finite(o.h, 2) && finite(o.c, 2) && finite(o.o, 2) && Number.isFinite(o.len))));
  if (badOpening >= 0) return issue(`openings[${badOpening}]`, 'v1-unreadable', { reason: 'opening' });
  const shared = validateSharedFields(doc, 'saved');
  return { ok: shared.ok, errors: shared.errors };
}

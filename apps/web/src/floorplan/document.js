import { createId } from './ids.js';
import { REFERENCE_DIMENSIONS } from './dimensions.js';
import { WALLS, WINS, DOORS, SLIDES, ROOMS, MATS, defaultFurniture } from './seed.js';

/** Document coordinates and dimensions are millimetres. UI state is stored separately. */
export function createDocument() {
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
const point = p => isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const uniqueIds = items => new Set(items.map(item => item.id)).size === items.length;
// Same ranges as the estimate inputs: prices >= 0 (null = not filled), waste 0–100 %.
const priceMap = value => value === undefined || isObject(value) && Object.values(value).every(v => v === null || Number.isFinite(v) && v >= 0);
// Rejects anything the renderers would read without guarding, so a damaged plan fails at load instead of during render.
export function validateDocument(doc) {
  if (!isObject(doc) || doc.schemaVersion !== 1 || doc.units !== 'mm' ||
      !Array.isArray(doc.furniture) || !Array.isArray(doc.rooms) ||
      !Array.isArray(doc.walls) || !Array.isArray(doc.openings)) return false;
  const measurements = doc.measurements ?? [], cost = doc.costEstimate;
  return doc.furniture.every(f => isObject(f) && typeof f.id === 'string' && typeof f.type === 'string' && typeof f.name === 'string' &&
      ['cx','cy','w','d','rot'].every(k => Number.isFinite(f[k])) && f.w > 0 && f.d > 0) && uniqueIds(doc.furniture) &&
    doc.walls.every(w => isObject(w) && typeof w.id === 'string' && typeof w.type === 'string' && finite(w.rect, 4)) &&
    doc.openings.every(o => isObject(o) && typeof o.id === 'string' && typeof o.type === 'string' && finite(o.rect, 4) &&
      (o.type !== 'door' || finite(o.h, 2) && finite(o.c, 2) && finite(o.o, 2) && Number.isFinite(o.len))) &&
    doc.rooms.every(r => isObject(r) && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.mat === 'string' &&
      Array.isArray(r.poly) && r.poly.length >= 3 && r.poly.every(p => finite(p, 2)) && (r.at === undefined || finite(r.at, 2))) &&
    isObject(doc.materials) && Object.values(doc.materials).every(m => isObject(m) && typeof m.name === 'string' && typeof m.sw === 'string') &&
    Array.isArray(measurements) && measurements.every(m => isObject(m) && typeof m.id === 'string' && point(m.a) && point(m.b)) &&
    (doc.dimensions === undefined || Array.isArray(doc.dimensions) && doc.dimensions.every(c => isObject(c) &&
      typeof c.horizontal === 'boolean' && Number.isFinite(c.at) && Number.isFinite(c.start) &&
      Array.isArray(c.segments) && c.segments.every(Number.isFinite))) &&
    (cost === undefined || isObject(cost) && priceMap(cost.furniturePrices) && priceMap(cost.materialPrices) &&
      (cost.wastePercent === undefined || Number.isFinite(cost.wastePercent) && cost.wastePercent >= 0 && cost.wastePercent <= 100));
}

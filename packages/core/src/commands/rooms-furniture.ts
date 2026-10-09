import { polygonArea, polygonSelfCrossing } from '../rooms.js';
import type { Furniture, PlanV2, Point, Room } from '../types.js';
import { ROOM_MIN_AREA } from '../validate.js';
import type { FurnitureCommand, RoomCommand } from './types.js';
import { newId, readFields, refuse, type Step } from './support.js';

const ROOM_FIELDS = { name: 'string', mat: 'id', poly: 'polygon', at: 'point', counted: 'boolean' } as const;
const FURNITURE_FIELDS = { type: 'string', name: 'string', cx: 'number', cy: 'number', w: 'number', d: 'number', rot: 'number', color: 'string' } as const;

function findRoom(plan: PlanV2, roomId: string): Room {
  return plan.rooms.find(r => r.id === roomId) ?? refuse('roomId', 'room-missing', { roomId });
}
function findFurniture(plan: PlanV2, furnitureId: string): Furniture {
  return plan.furniture.find(f => f.id === furnitureId) ?? refuse('furnitureId', 'furniture-missing', { furnitureId });
}

/**
 * The room rules that the validator only warns about (roadmap C1). A new room must keep them all. For a changed room,
 * an existing issue that the command does not make worse is kept (see `checkOpening` in support.ts): a new material must
 * exist, and a new outline must not cross itself; a small area can grow toward the minimum but not shrink.
 */
function checkRoom(plan: PlanV2, room: Room, before: Room | null) {
  if (!Object.hasOwn(plan.materials, room.mat) && room.mat !== before?.mat) refuse('mat', 'room-material-missing', { mat: room.mat, use: ['set_material'] });
  if (room.poly.length < 3) refuse('poly', 'room-too-few-points', { count: room.poly.length });
  const newOutline = !before || room.poly.length !== before.poly.length || room.poly.some((p, i) => p[0] !== before.poly[i][0] || p[1] !== before.poly[i][1]);
  const crossing = polygonSelfCrossing(room.poly);
  if (crossing && newOutline) refuse('poly', 'room-self-crossing');
  if (crossing) return;
  const gap = ROOM_MIN_AREA - polygonArea(room.poly);
  // The gap before: none if the room is new, if its area was large enough, or if its outline crossed itself (no area).
  const wasGap = before && before.poly.length >= 3 && !polygonSelfCrossing(before.poly) ? ROOM_MIN_AREA - polygonArea(before.poly) : 0;
  if (gap > 0 && (wasGap <= 0 || gap > wasGap)) refuse('poly', 'room-area-too-small', { area: polygonArea(room.poly) / 1e6, min: ROOM_MIN_AREA / 1e6 });
}
function checkFurniture(f: Furniture) {
  for (const key of ['w', 'd'] as const) if (!(f[key] > 0)) refuse(key, 'size-not-positive', { value: f[key] });
}
const points = (poly: Point[]): Point[] => poly.map(p => [p[0], p[1]]);

function addRoom(plan: PlanV2, c: Extract<RoomCommand, { op: 'add_room' }>): Step {
  readFields(c, { required: { name: 'string', mat: 'id', poly: 'polygon' }, optional: { id: 'id', at: 'point', counted: 'boolean' } });
  const { id, notes } = newId(plan.rooms, c.id, 'room', 'rooms');
  const room: Room = { id, name: c.name, mat: c.mat, poly: points(c.poly) };
  if (c.at !== undefined) room.at = [c.at[0], c.at[1]];
  if (c.counted !== undefined) room.counted = c.counted;
  checkRoom(plan, room, null);
  return { plan: { ...plan, rooms: [...plan.rooms, room] }, notes };
}

function updateRoom(plan: PlanV2, c: Extract<RoomCommand, { op: 'update_room' }>): Step {
  readFields(c, { required: { roomId: 'id' }, optional: ROOM_FIELDS, use: { id: [] } });
  const room = findRoom(plan, c.roomId), next: Room = { ...room };
  if (c.name !== undefined) next.name = c.name;
  if (c.mat !== undefined) next.mat = c.mat;
  if (c.poly !== undefined) next.poly = points(c.poly);
  if (c.at !== undefined) next.at = [c.at[0], c.at[1]];
  if (c.counted !== undefined) next.counted = c.counted;
  checkRoom(plan, next, room);
  return { plan: { ...plan, rooms: plan.rooms.map(r => r.id === room.id ? next : r) } };
}

function deleteRoom(plan: PlanV2, c: Extract<RoomCommand, { op: 'delete_room' }>): Step {
  readFields(c, { required: { roomId: 'id' } });
  const room = findRoom(plan, c.roomId);
  return { plan: { ...plan, rooms: plan.rooms.filter(r => r.id !== room.id) } };
}

function addFurniture(plan: PlanV2, c: Extract<FurnitureCommand, { op: 'add_furniture' }>): Step {
  readFields(c, { required: { type: 'string', name: 'string', cx: 'number', cy: 'number', w: 'number', d: 'number' }, optional: { id: 'id', rot: 'number', color: 'string' } });
  const { id, notes } = newId(plan.furniture, c.id, 'furniture', 'furniture');
  const item: Furniture = { id, type: c.type, name: c.name, cx: c.cx, cy: c.cy, w: c.w, d: c.d, rot: c.rot ?? 0, ...(c.color !== undefined ? { color: c.color } : {}) };
  checkFurniture(item);
  return { plan: { ...plan, furniture: [...plan.furniture, item] }, notes };
}

function updateFurniture(plan: PlanV2, c: Extract<FurnitureCommand, { op: 'update_furniture' }>): Step {
  readFields(c, { required: { furnitureId: 'id' }, optional: FURNITURE_FIELDS, use: { id: [] } });
  const item = findFurniture(plan, c.furnitureId);
  const { op: _op, furnitureId: _id, ...changes } = c;
  const next: Furniture = { ...item, ...changes };
  checkFurniture(next);
  return { plan: { ...plan, furniture: plan.furniture.map(f => f.id === item.id ? next : f) } };
}

function deleteFurniture(plan: PlanV2, c: Extract<FurnitureCommand, { op: 'delete_furniture' }>): Step {
  readFields(c, { required: { furnitureId: 'id' } });
  const item = findFurniture(plan, c.furnitureId), next: PlanV2 = { ...plan, furniture: plan.furniture.filter(f => f.id !== item.id) };
  // The cost estimate keys furniture prices by item id; a price for a deleted item would never be used again.
  const prices = plan.costEstimate?.furniturePrices;
  if (!prices || !Object.hasOwn(prices, item.id)) return { plan: next };
  const { [item.id]: _price, ...rest } = prices;
  return { plan: { ...next, costEstimate: { ...plan.costEstimate, furniturePrices: rest } }, notes: [{ code: 'furniture-price-removed', params: { furnitureId: item.id } }] };
}

export const ROOM_FURNITURE_COMMANDS = {
  add_room: addRoom, update_room: updateRoom, delete_room: deleteRoom,
  add_furniture: addFurniture, update_furniture: updateFurniture, delete_furniture: deleteFurniture,
} as const;

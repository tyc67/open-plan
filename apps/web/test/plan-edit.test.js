import { describe, expect, it } from 'vitest';
import { applyCommands, containsPoint, createEmptyPlan, createSamplePlan, wallLength } from 'open-plan-core';
import { addOpeningCommand, addRoomCommands, DEFAULT_MATERIAL, deletePoint, insertPoint, interiorPoint, movedPoly, rectanglePoly, samePoly, snapRoomPoint, distanceAlong, dragOffset, joinCandidates, newWallThickness, OPENING_DEFAULTS, openingTypeCommand, openingTypeFields, runEdit, snapWallPoint, wallEnd, wallHeading, wallLengthCommand, wallPoint } from '../src/floorplan/planEdit.js';
import { editMessages, editNoteLines } from '../src/floorplan/issueMessages.js';

// Editing in the editor through the core commands (roadmap D4a): the editor builds the commands, and the core decides.
const wall = (id, a, b, more = {}) => ({ id, type: 'n', a, b, thickness: 120, ...more });
const plan = (walls, openings = []) => ({ ...createEmptyPlan(), walls, openings });
const door = (id, wallId, offset) => ({ id, type: 'door', wallId, offset, width: 900, hinge: 'start', swing: 'left', head: 2100 });

describe('edits through the core commands', () => {
  it('runEdit: ok with the plan, notes and the warnings of the commands; same; refused with no plan', () => {
    const p = plan([wall('w1', [0, 0], [4000, 0])], [door('d1', 'w1', 500)]);
    const deleted = runEdit(p, [{ op: 'delete_wall', wallId: 'w1' }]);
    expect([deleted.status, deleted.plan.walls.length, deleted.plan.openings.length, deleted.notes.map(n => n.code)]).toEqual(['ok', 0, 0, ['openings-deleted']]);
    expect(runEdit(p, [{ op: 'update_wall', wallId: 'w1', thickness: 120 }]).status).toBe('same');
    const refused = runEdit(p, [{ op: 'update_wall', wallId: 'w1', thickness: 5000 }]);
    expect([refused.status, refused.plan, refused.errors[0].code]).toEqual(['refused', undefined, 'thickness-out-of-range']);
    expect(p.walls[0].thickness).toBe(120);
  });
  it('a new length moves the chosen end along the wall line, for each direction of the wall; the other end stays', () => {
    for (const [a, b] of [[[0, 0], [4000, 0]], [[4000, 0], [0, 0]], [[0, 0], [0, 4000]], [[0, 4000], [0, 0]]]) {
      for (const end of ['a', 'b']) {
        const p = plan([wall('w1', a, b)]), result = runEdit(p, [wallLengthCommand(p.walls[0], end, 3000)]);
        const moved = result.plan.walls[0], kept = end === 'a' ? 'b' : 'a';
        expect([result.status, wallLength(moved), moved[kept]]).toEqual(['ok', 3000, p.walls[0][kept]]);
      }
    }
  });
  it('a shorter wall that would leave an opening outside is refused, with a message in zh-TW and no command path', () => {
    const p = plan([wall('w1', [0, 0], [4000, 0])], [door('d1', 'w1', 3000)]);
    const refused = runEdit(p, [wallLengthCommand(p.walls[0], 'b', 3500)]);
    expect(refused.status).toBe('refused');
    const lines = editMessages(refused.errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('超出牆的長度');
    expect(lines[0]).not.toContain('commands[');
    expect(editMessages(runEdit(p, [{ op: 'update_wall', wallId: 'w1', thickness: 5000 }]).errors)[0]).toMatch(/^厚度：/);
  });
  it('split: the point at a distance from a; a point in an opening is refused', () => {
    const p = plan([wall('w1', [0, 1000], [0, 5000])], [door('d1', 'w1', 1000)]);
    expect(wallPoint(p.walls[0], 2500)).toEqual([0, 3500]);
    const split = runEdit(p, [{ op: 'split_wall', wallId: 'w1', at: wallPoint(p.walls[0], 2500) }]);
    expect([split.status, split.plan.walls.map(w => wallLength(w))]).toEqual(['ok', [2500, 1500]]);
    const inDoor = runEdit(p, [{ op: 'split_wall', wallId: 'w1', at: wallPoint(p.walls[0], 1500) }]);
    expect([inDoor.status, editMessages(inDoor.errors)[0]]).toEqual(['refused', '分割位置在開口「d1」裡面']);
  });
  it('join candidates are exactly the walls that the join command accepts', () => {
    const p = plan([wall('w1', [0, 0], [2000, 0]), wall('touch', [2000, 0], [5000, 0]), wall('gap', [6000, 0], [8000, 0]), wall('thick', [-1000, 0], [0, 0], { thickness: 200 }),
      wall('type', [-2000, 0], [0, 0], { type: 'b' }), wall('corner', [0, 0], [0, 3000]), wall('parallel', [0, 500], [2000, 500])]);
    expect(joinCandidates(p, 'w1').map(w => w.id)).toEqual(['touch']);
    for (const other of p.walls.slice(1)) expect(applyCommands(p, [{ op: 'join_walls', wallId: 'w1', otherId: other.id }]).ok).toBe(other.id === 'touch');
    expect(joinCandidates(p, 'none')).toEqual([]);
  });
  it('a new wall: the thickness of the nearest wall, or 120 mm with no wall; the end from a direction and a length', () => {
    const p = plan([wall('thin', [0, 0], [4000, 0], { thickness: 100 }), wall('thick', [0, 5000], [4000, 5000], { thickness: 240 })]);
    expect([newWallThickness(p, [2000, 300]), newWallThickness(p, [2000, 4000]), newWallThickness(plan([]), [0, 0])]).toEqual([100, 240, 120]);
    expect([wallEnd([100, 200], 'right', 3000), wallEnd([100, 200], 'left', 3000), wallEnd([100, 200], 'down', 3000), wallEnd([100, 200], 'up', 3000)]).toEqual([[3100, 200], [-2900, 200], [100, 3200], [100, -2800]]);
  });
  it('add-wall points: the first goes to a near wall end or the 10 mm grid; the second makes a horizontal or vertical wall to the line of a near wall end', () => {
    const p = plan([wall('w1', [0, 0], [4000, 0]), wall('w2', [4000, 0], [4000, 3000])]);
    expect([snapWallPoint([3990, 12], p, 50), snapWallPoint([2003, 1504], p, 50)]).toEqual([[4000, 0], [2000, 1500]]);
    expect(snapWallPoint([3980, 3040], p, 50, [0, 3000])).toEqual([4000, 3000]);          // horizontal, to the line of the end of w2
    expect(snapWallPoint([2504, 3300], p, 50, [0, 3000])).toEqual([2500, 3000]);          // horizontal, on the grid
    expect(snapWallPoint([40, 5503], p, 50, [0, 3000])).toEqual([0, 5500]);               // vertical
    const added = runEdit(p, [{ op: 'add_wall', type: 'n', a: [0, 3000], b: snapWallPoint([3980, 3040], p, 50, [0, 3000]), thickness: 120 }]);
    expect([added.status, added.notes[0].code]).toEqual(['ok', 'id-generated']);
  });
  it('notes of an edit: deleted openings, and the rooms whose outline lost its wall', () => {
    const sample = createSamplePlan(), target = sample.walls.find(w => sample.openings.some(o => o.wallId === w.id));
    const result = runEdit(sample, [{ op: 'delete_wall', wallId: target.id }]);
    const also = editNoteLines(result), count = sample.openings.filter(o => o.wallId === target.id).length;
    expect(also.lines[0]).toBe(`牆上的 ${count} 個開口也一併刪除了。`);
    expect(also.roomIds.every(id => sample.rooms.some(r => r.id === id))).toBe(true);
    expect(editNoteLines({ notes: [], warnings: [{ path: 'rooms[0].poly', code: 'room-edge-off-wall', params: { roomId: 'r1' } }, { path: 'rooms[0].poly', code: 'room-edge-off-wall', params: { roomId: 'r1' } }] })).toEqual({ lines: ['有 1 個空間的外框不再貼著牆面；空間外框不會自動調整，請檢查。'], roomIds: ['r1'] });
  });
});

// Openings (roadmap D4b): the core gives no width, hinge or swing, and no heights for a change of type, so the editor
// supplies them. Each command below is run by the core, which decides.
describe('openings through the core commands', () => {
  const TYPES = ['door', 'window', 'sliding-door', 'hole'];
  const windowAt = (id, wallId, offset) => ({ id, type: 'window', wallId, offset, width: 1000, sill: 900, head: 2400 });
  it('a new opening of each type: the default width, in the free part nearest to the wall centre, accepted by the core', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])]);
    for (const type of TYPES) {
      const command = addOpeningCommand(p, p.walls[0], type), result = runEdit(p, [command]);
      expect([type, result.status, command.offset, command.width]).toEqual([type, 'ok', (5000 - OPENING_DEFAULTS[type].width) / 2, OPENING_DEFAULTS[type].width]);
      const added = result.plan.openings[0];
      expect(Object.keys(added).sort()).toEqual({ door: ['head', 'hinge', 'id', 'offset', 'swing', 'type', 'wallId', 'width'], window: ['head', 'id', 'offset', 'sill', 'type', 'wallId', 'width'] }[type] ?? ['head', 'id', 'offset', 'type', 'wallId', 'width']);
    }
  });
  it('a new opening goes beside an opening that has the centre; a wall with no free part long enough gets no command', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])], [door('d1', 'w1', 2000)]);                    // the door has 2000 to 2900
    const beside = addOpeningCommand(p, p.walls[0], 'door');
    expect([beside.offset, runEdit(p, [beside]).status]).toEqual([2900, 'ok']);                     // the centred place is 2050: 2900 is nearer than 1100
    const short = plan([wall('w1', [0, 0], [800, 0])]), full = plan([wall('w1', [0, 0], [2000, 0])], [door('d1', 'w1', 600)]);
    expect([addOpeningCommand(short, short.walls[0], 'door'), addOpeningCommand(full, full.walls[0], 'window')]).toEqual([null, null]);
    expect(addOpeningCommand(full, full.walls[0], 'door')).toBe(null);                              // 600 before the door and 500 after it
    const exact = plan([wall('w1', [0, 0], [900, 0])]);
    expect(runEdit(exact, [addOpeningCommand(exact, exact.walls[0], 'hole')]).status).toBe('ok');
  });
  it('a change of type sends every field of the new type, for each pair of types; the core accepts it', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])]);
    for (const from of TYPES) {
      const made = runEdit(p, [{ ...addOpeningCommand(p, p.walls[0], from), id: 'o1' }]).plan;
      for (const to of TYPES.filter(t => t !== from)) {
        const result = runEdit(made, [openingTypeCommand(made, made.openings[0], to)]);
        expect([from, to, result.status, result.plan?.openings[0].type]).toEqual([from, to, 'ok', to]);
        expect(result.plan.openings[0].width).toBe(made.openings[0].width);
      }
    }
  });
  it('type fields: a door, a sliding door and a hole keep the head of each other; a window starts from its defaults; no height is above a low ceiling', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])]), tall = { id: 'o1', type: 'hole', wallId: 'w1', offset: 0, width: 900, head: 2500 };
    expect(openingTypeFields('door', p, tall)).toEqual({ hinge: 'start', swing: 'left', head: 2500 });
    expect(openingTypeFields('window', p, tall)).toEqual({ sill: 900, head: 2400 });
    expect(openingTypeFields('hole', p, windowAt('w', 'w1', 0))).toEqual({ head: 2100 });
    const low = { ...p, ceilingHeight: 2000, openings: [{ ...tall, head: 1900 }] };
    expect(openingTypeFields('window', low)).toEqual({ sill: 900, head: 2000 });
    expect(openingTypeFields('door', low).head).toBe(2000);
    for (const to of ['door', 'window', 'sliding-door']) expect(runEdit(low, [openingTypeCommand(low, low.openings[0], to)]).status).toBe('ok');
    expect(runEdit(low, [addOpeningCommand({ ...low, openings: [] }, low.walls[0], 'window')]).status).toBe('ok');
  });
  it('a window is refused in a low wall, by a change of type and by a move; a window that is there can still be edited', () => {
    const p = plan([wall('low', [0, 0], [5000, 0], { type: 'low' }), wall('n', [0, 3000], [5000, 3000])], [{ id: 'h1', type: 'hole', wallId: 'low', offset: 500, width: 900, head: 2100 }, windowAt('win', 'n', 500)]);
    const changed = runEdit(p, [openingTypeCommand(p, p.openings[0], 'window')]);
    expect([changed.status, editMessages(changed.errors)[0]]).toEqual(['refused', '類型：窗戶位在矮牆上，玻璃會高出矮牆']);
    const moved = runEdit(p, [{ op: 'move_opening', openingId: 'win', wallId: 'low', offset: 2000 }]);
    const move = [{ op: 'move_opening', openingId: 'win', wallId: 'low', offset: 2000 }];
    expect([moved.status, editMessages(moved.errors, move)[0]]).toEqual(['refused', '所在牆：窗戶位在矮牆上，玻璃會高出矮牆']);
    // In a wall command, `wallId` is the wall itself: the reason gets no field name (found in a review).
    const outer = plan([wall('e1', [0, 0], [5000, 0], { type: 'e' })]), toggle = [{ op: 'toggle_demolition', wallId: 'e1' }];
    expect(editMessages(runEdit(outer, toggle).errors, toggle)).toEqual(['外牆不能標記拆除；可在牆體屬性按「恢復牆體」']);
    expect(runEdit(p, [addOpeningCommand(p, p.walls[0], 'window')]).errors[0].code).toBe('window-in-low-wall');
  });
  it('an opening in a demolished wall: no move in the wall, no resize and no drag; a new name, new heights, delete and a move out are accepted', () => {
    const p = plan([wall('gone', [0, 0], [5000, 0], { demolished: true }), wall('n', [0, 3000], [5000, 3000])], [door('d1', 'gone', 500)]);
    expect(runEdit(p, [{ op: 'move_opening', openingId: 'd1', offset: 1000 }]).errors[0].code).toBe('wall-demolished');
    expect(runEdit(p, [{ op: 'resize_opening', openingId: 'd1', width: 800, keep: 'start' }]).errors[0].code).toBe('wall-demolished');
    expect(dragOffset(p, 'd1', 1000)).toBe(null);
    for (const command of [{ op: 'update_opening', openingId: 'd1', name: '舊門' }, { op: 'update_opening', openingId: 'd1', head: 2000 }, { op: 'delete_opening', openingId: 'd1' }, { op: 'move_opening', openingId: 'd1', wallId: 'n', offset: 500 }])
      expect([command, runEdit(p, [command]).status]).toEqual([command, 'ok']);
  });
  it('resize: the edge at a, or the edge at b, stays', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])], [door('d1', 'w1', 1000)]);
    const start = runEdit(p, [{ op: 'resize_opening', openingId: 'd1', width: 700, keep: 'start' }]).plan.openings[0];
    const end = runEdit(p, [{ op: 'resize_opening', openingId: 'd1', width: 700, keep: 'end' }]).plan.openings[0];
    expect([[start.offset, start.width], [end.offset, end.width]]).toEqual([[1000, 700], [1200, 700]]);
  });
  it('a door that moves to a wall with the opposite direction keeps its offset, hinge and swing: they are from end a of the new wall', () => {
    const p = plan([wall('east', [0, 0], [5000, 0]), wall('west', [5000, 3000], [0, 3000])], [door('d1', 'east', 500)]);
    expect([wallHeading(p.walls[0]), wallHeading(p.walls[1]), wallHeading(wall('s', [0, 0], [0, 9])), wallHeading(wall('n', [0, 9], [0, 0]))]).toEqual(['right', 'left', 'down', 'up']);
    const moved = runEdit(p, [{ op: 'move_opening', openingId: 'd1', wallId: 'west', offset: 500 }]).plan.openings[0];
    expect(moved).toEqual({ ...p.openings[0], wallId: 'west' });
    // In the plan, the door is now 500 mm from the right end, not from the left one.
    expect(distanceAlong(p.walls[1], [4500, 3000])).toBe(500);
  });
  it('a dragged opening stays on the 10 mm grid, in the wall, and between the openings beside it; an existing overlap cannot be dragged', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])], [door('left', 'w1', 0), door('mid', 'w1', 2000), door('right', 'w1', 4100)]);
    expect([dragOffset(p, 'mid', 2504), dragOffset(p, 'mid', -400), dragOffset(p, 'mid', 9000), dragOffset(p, 'left', -50), dragOffset(p, 'right', 4800)]).toEqual([2500, 900, 3200, 0, 4100]);
    for (const wanted of [-400, 2504, 9000]) expect(runEdit(p, [{ op: 'move_opening', openingId: 'mid', offset: dragOffset(p, 'mid', wanted) }]).status).toBe('ok');
    const vertical = plan([wall('up', [0, 4000], [0, 0])], [door('d1', 'up', 1000)]);
    expect(dragOffset(vertical, 'd1', distanceAlong(vertical.walls[0], [0, 1500]))).toBe(2500);
    // A limit that is not on the grid is kept exactly, not rounded past the wall end or the opening beside it.
    const fine = plan([wall('w1', [0, 0], [5000.4, 0])], [door('d1', 'w1', 1000), { ...door('d2', 'w1', 3000.3), width: 900.2 }]);
    expect([dragOffset(fine, 'd2', 9000), dragOffset(fine, 'd1', 9000)]).toEqual([5000.4 - 900.2, 3000.3 - 900]);
    for (const [id, wanted] of [['d1', 9000], ['d2', 9000], ['d2', 0]]) expect(runEdit(fine, [{ op: 'move_opening', openingId: id, offset: dragOffset(fine, id, wanted) }]).status).toBe('ok');
    const crowded = plan([wall('w1', [0, 0], [1500, 0])], [door('a', 'w1', 0), door('b', 'w1', 600)]);
    expect([dragOffset(crowded, 'a', 100), dragOffset(p, 'none', 0)]).toEqual([null, null]);
  });
});

// Rooms (roadmap D4c): the editor makes the outline, and the core decides.
describe('rooms through the core commands', () => {
  const room = (id, poly, more = {}) => ({ id, name: id, mat: 'wood', poly, ...more });
  const withRooms = (rooms, walls = []) => ({ ...createEmptyPlan(), walls, rooms, materials: { wood: { name: '木地板', sw: '#d8b88a' } } });
  const square = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]];
  it('outline helpers: move one point, insert at the middle of an edge (also the closing edge), delete, a rectangle; the input is not changed', () => {
    expect(movedPoly(square, 2, [5000, 3500])).toEqual([[0, 0], [4000, 0], [5000, 3500], [0, 3000]]);
    expect(insertPoint(square, 0)).toEqual([[0, 0], [2000, 0], [4000, 0], [4000, 3000], [0, 3000]]);
    expect(insertPoint(square, 3)).toEqual([[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 1500]]);
    expect(deletePoint(square, 1)).toEqual([[0, 0], [4000, 3000], [0, 3000]]);
    expect(rectanglePoly(100, 200, 4000, 3000)).toEqual([[100, 200], [4100, 200], [4100, 3200], [100, 3200]]);
    expect(square).toEqual([[0, 0], [4000, 0], [4000, 3000], [0, 3000]]);
    expect([samePoly(square, movedPoly(square, 0, [0, 0])), samePoly(square, deletePoint(square, 0)), samePoly(square, movedPoly(square, 0, [1, 0]))]).toEqual([true, false, false]);
    expect(movedPoly(square, 0, [0, 0])[1]).not.toBe(square[1]);
  });
  it('an inserted point works for each direction of the outline: the new point can move, and the core accepts the result', () => {
    for (const poly of [square, [...square].reverse()]) {
      const p = withRooms([room('r1', poly)]), more = insertPoint(poly, 1), pulled = movedPoly(more, 2, [more[2][0] + 500, more[2][1] + 500]);
      expect(runEdit(p, [{ op: 'update_room', roomId: 'r1', poly: more }]).status).toBe('ok');
      expect(runEdit(p, [{ op: 'update_room', roomId: 'r1', poly: pulled }]).plan.rooms[0].poly).toEqual(pulled);
    }
  });
  it('snap: a wall face only near that face; a point of another room when it is near; the line of an adjacent point; else the 10 mm grid; free gives the grid only', () => {
    const p = withRooms([], [wall('w1', [0, 0], [4000, 0], { thickness: 200 })]);                 // faces at y -100 and 100, ends at x 0 and 4000
    expect(snapRoomPoint([2003, 130], p, 50)).toEqual([2000, 100]);                                // near the lower face
    expect(snapRoomPoint([2003, -70], p, 50)).toEqual([2000, -100]);                               // the nearest of the two faces
    expect(snapRoomPoint([9003, 130], p, 50)).toEqual([9000, 130]);                                // the same Y, but far from the wall: no pull
    expect(snapRoomPoint([4030, 2000], p, 50)).toEqual([4030, 2000]);                              // the same X as the wall end, but far from it
    expect(snapRoomPoint([4030, 120], p, 50)).toEqual([4000, 100]);                                // the corner of the wall
    expect(snapRoomPoint([3033, 2018], p, 50, { near: [[3000, 2000]] })).toEqual([3000, 2000]);
    expect(snapRoomPoint([3033, 2078], p, 50, { near: [[3000, 2000]] })).toEqual([3030, 2080]);    // more than the tolerance away
    expect(snapRoomPoint([3033, 2504], p, 50, { align: [[3000, 7000], [9000, 2500]] })).toEqual([3000, 2500]);
    expect(snapRoomPoint([2003, 130], p, 50, { near: [[2000, 100]], align: [[2000, 100]], free: true })).toEqual([2000, 130]);
  });
  it('the label point of a new room is inside the outline, not on its edge, for a rectangle, an L shape and a U shape', () => {
    const shapes = { rectangle: square, l: [[0, 0], [4000, 0], [4000, 1000], [1000, 1000], [1000, 3000], [0, 3000]], u: [[0, 0], [1000, 0], [1000, 2000], [3000, 2000], [3000, 0], [4000, 0], [4000, 3000], [0, 3000]] };
    expect(interiorPoint(square)).toEqual([2000, 1500]);
    for (const [name, poly] of Object.entries(shapes)) {
      const at = interiorPoint(poly);
      // Inside, and so are the points 10 mm around it: the point is not on an edge.
      expect([name, ...[[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]].map(([dx, dy]) => containsPoint(poly, at[0] + dx, at[1] + dy))]).toEqual([name, true, true, true, true, true]);
    }
    expect(containsPoint(shapes.u, 2000, 1000)).toBe(false);                                       // the middle of the U is outside it
    expect(interiorPoint([[0, 0], [4000, 0], [8000, 0]])).toBe(null);
    // Found in a review: point heights at each of the old fixed line heights gave no point, and so a room with no label.
    const steps = [0, 630, 1110, 1500, 1890, 2370, 3000], stairs = [[0, 0], [4000, 0], ...steps.slice(1).map(y => [4000, y]), [0, 3000], ...steps.slice(1, -1).reverse().map(y => [0, y])];
    const label = interiorPoint(stairs);
    // Points in the middle of a straight side make no band, so the label is at the centre of this rectangle.
    expect([label, containsPoint(stairs, label[0], label[1])]).toEqual([[2000, 1500], true]);
    expect(addRoomCommands(withRooms([]), stairs)[0].at).toEqual(label);
    // The same heights at real corners (no point is in the middle of a straight side): the line of the label is not at a point height.
    const zigzag = [[0, 0], [4000, 0], ...steps.slice(1, -1).map((y, i) => [i % 2 ? 4000 : 3900, y]), [4000, 3000], [0, 3000]], inZigzag = interiorPoint(zigzag);
    expect([inZigzag !== null, containsPoint(zigzag, inZigzag[0], inZigzag[1]), steps.includes(inZigzag[1])]).toEqual([true, true, false]);
    // Found in a review: a repeated corner is in line with its copy; it must stay a corner.
    const twice = square.flatMap(p => [p, p]), cornerTwice = [[0, 0], [4000, 0], [4000, 1000], [1000, 1000], [1000, 1000], [1000, 4000], [0, 4000]];
    expect(interiorPoint(twice)).toEqual([2000, 1500]);
    expect([interiorPoint(cornerTwice), containsPoint(cornerTwice, ...interiorPoint(cornerTwice))]).toEqual([[2000, 500], true]);
    expect(interiorPoint([...square, square[0]])).toEqual([2000, 1500]);                            // the first point again at the end
    // A very thin room: rounding to 0.1 mm must not put the point on an edge.
    const thin = interiorPoint([[0, 0], [0.1, 0], [0.1, 100000], [0, 100000]]);
    expect([thin[0] > 0 && thin[0] < 0.1, thin[1]]).toEqual([true, 50000]);
    // Found in a review: beside a sloping edge, rounding X and Y one by one gave a point outside the outline.
    const sliver = [[0, 0], [3000000, 0.11], [3000000, 0.12]], inSliver = interiorPoint(sliver);
    const strictlyInside = (poly, [x, y]) => { const xs = []; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1])); }); xs.sort((m, n) => m - n); return xs.length === 2 && xs[0] < x && x < xs[1]; };
    expect([strictlyInside(sliver, inSliver), strictlyInside(sliver, [1437500, 0.1])]).toEqual([true, false]);
    const slope = [[0, 0], [4000, 0], [1000, 3000]];                                               // a triangle with two sloping edges
    expect([interiorPoint(slope), strictlyInside(slope, interiorPoint(slope))]).toEqual([[1500, 1500], true]);
    // Each band of an L shape is a candidate: the point is in the larger part.
    expect(interiorPoint(shapes.l)).toEqual([2000, 500]);
  });
  it('a new room: the first material and a label inside; a plan with no material gets the default material in the same batch', () => {
    const p = withRooms([]), commands = addRoomCommands(p, square), result = runEdit(p, commands);
    expect([commands.length, result.status, result.plan.rooms[0]]).toEqual([1, 'ok', { id: result.plan.rooms[0].id, name: '新空間', mat: 'wood', poly: square, at: [2000, 1500] }]);
    const bare = { ...createEmptyPlan(), materials: {} }, batch = addRoomCommands(bare, square), made = runEdit(bare, batch);
    expect(batch.map(c => c.op)).toEqual(['set_material', 'add_room']);
    expect([made.status, made.plan.materials, made.plan.rooms[0].mat]).toEqual(['ok', { [DEFAULT_MATERIAL.key]: { name: DEFAULT_MATERIAL.name, sw: DEFAULT_MATERIAL.sw } }, DEFAULT_MATERIAL.key]);
    // The batch is atomic: a refused room adds no material.
    const crossing = runEdit(bare, addRoomCommands(bare, [[0, 0], [4000, 3000], [4000, 0], [0, 3000]]));
    expect([crossing.status, editMessages(crossing.errors)[0], bare.materials]).toEqual(['refused', '外框：外框的邊互相交叉', {}]);
  });
  it('core rules for an outline edit: crossing and too few points are refused; a room that is too small can grow in steps, and cannot get smaller', () => {
    const p = withRooms([room('r1', square), room('tiny', [[0, 0], [50, 0], [50, 50], [0, 50]])]);
    const crossed = runEdit(p, [{ op: 'update_room', roomId: 'r1', poly: movedPoly(square, 0, [3000, 4000]) }]);
    expect([crossed.status, editMessages(crossed.errors)[0]]).toEqual(['refused', '外框：外框的邊互相交叉']);
    expect(runEdit(p, [{ op: 'update_room', roomId: 'r1', poly: deletePoint(deletePoint(square, 0), 0) }]).errors[0].code).toBe('room-too-few-points');
    const tiny = p.rooms[1].poly;
    expect(runEdit(p, [{ op: 'update_room', roomId: 'tiny', poly: movedPoly(tiny, 2, [60, 60]) }]).status).toBe('ok');             // larger, still below 0.01 m²
    expect(runEdit(p, [{ op: 'update_room', roomId: 'tiny', poly: movedPoly(tiny, 2, [40, 40]) }]).errors[0].code).toBe('room-area-too-small');
    expect(runEdit(p, [{ op: 'update_room', roomId: 'none', poly: square }]).errors.map(e => editMessages([e])[0])).toEqual(['找不到空間「none」']);
  });
  it('an outline edit keeps the label and the other fields of the room; delete removes only the room', () => {
    const p = { ...withRooms([room('r1', square, { at: [500, 500], counted: false })]), furniture: [{ id: 'f1', type: 'sofa', name: '沙發', cx: 1000, cy: 1000, w: 800, d: 800, rot: 0 }] };
    const moved = runEdit(p, [{ op: 'update_room', roomId: 'r1', poly: movedPoly(square, 2, [5000, 3000]) }]).plan.rooms[0];
    expect([moved.at, moved.counted, moved.name, moved.mat]).toEqual([[500, 500], false, 'r1', 'wood']);
    const deleted = runEdit(p, [{ op: 'delete_room', roomId: 'r1' }]).plan;
    expect([deleted.rooms, deleted.furniture.length, deleted.materials]).toEqual([[], 1, p.materials]);
    for (const values of [{ name: '客廳' }, { counted: true }]) expect(runEdit(p, [{ op: 'update_room', roomId: 'r1', ...values }]).status).toBe('ok');
    expect(runEdit(p, [{ op: 'update_room', roomId: 'r1', mat: 'none' }]).errors[0].code).toBe('room-material-missing');
  });
});

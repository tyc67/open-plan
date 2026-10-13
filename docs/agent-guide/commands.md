## Commands

A batch is a list of commands that changes a plan. Use a batch for every change to an existing plan. "Sending a batch" (in the CLI part or the MCP part) shows how to send it, with the revision of the plan that you read.

### The batch

- **`expectedRevision`** (required) is sent with the batch: the revision of the plan that you read, 64 hex characters, the SHA-256 of the raw file bytes. If the file changed since then, nothing is written: the result is `REVISION_CONFLICT` with the `currentRevision`.
- **`commands`** is a list. The commands run in order, and each command sees the result of the commands before it.
- **The batch is atomic.** If one command is refused, or the result has an error, nothing is written. The result is `COMMANDS_REFUSED` with `errors`. Each error has `commandIndex` (zero-based), a `path` and a `code`. For a refused command, the path is in the batch, for example `commands[2].offset`; for an error in the result, the path is in the plan, and `commandIndex` is the first command after which the error exists.
- **Before the commands run**, the plan is checked. A plan with an error that blocks the editor is refused; fix it first (validate the plan). A schema version 1 file is refused with `NOT_VERSION_2`; migrate it first.
- **On success**, the result has the new `revision`, the `previousRevision`, the `backup` name, `warnings` and `notes`. Use the new revision for the next batch.
- **Warnings** do not stop the batch. They are issues that the editor accepts, for example a room edge that is no longer on a wall face (`room-edge-off-wall`). A warning that the plan already had has no `commandIndex`. Validation is stricter than a batch: after a batch, validate the plan.
- **Notes** tell you what changed beyond the command itself. `id-generated` (`{ list, id }`) gives the id of a new item that had no `id`; use that id in later commands. Other notes: `openings-deleted`, `wall-split`, `walls-joined`, `material-created`, `material-replaced`, `furniture-price-removed`, `dimensions-set`, `plan-scaled`.
- If the commands do not change the plan, the file is not written and the revision stays the same.

**After `REVISION_CONFLICT`:** the plan changed, for example because the user edited it in the editor. Do not send the same batch again without a check. Read the plan again, check that your commands still fit it (the ids exist, the positions are still correct), and then send them with the new revision.

### Rules for every command

- `op` names the command. An unknown `op` is refused (`command-op-unknown`, with the list of names).
- Lengths and positions are in millimetres; points are `[x, y]`. Angles are in degrees.
- An unknown field is refused (`command-field-unknown`, with the allowed fields), so a misspelled field is never ignored. A field of the wrong type is refused (`type-invalid`), a missing required field too (`missing-field`), and a value that is not in the list of allowed values too (`enum-invalid`).
- An `update_` command refuses a field that another command changes (`field-not-updatable`, with the command to use), and an `id` (ids cannot change).
- An id that does not exist is refused: `wall-missing`, `opening-missing`, `room-missing`, `furniture-missing`.
- A new item can have an `id`; one that is already used is refused (`id-duplicate`). Without an `id`, one is generated, and the `id-generated` note gives it.
- Commands do not make the problems that the validator rejects: a command that would make one is refused. A problem that the plan already has does not block a command that does not make it worse (see "A problem that the plan already has" under the opening rules).

The examples below start from the example plan in "Open Plan format": wall `w1` from `[0, 100]` to `[8000, 100]`, the openings `win1`, `d1`, `s1` and `hole1` in it, the room `r1` and the material `wood`. Each example is the `commands` list of one batch.

### Walls

#### `add_wall`

Adds a wall.

- `type` (required): `e` (exterior), `b` (bearing), `n` (partition) or `low` (low wall).
- `a`, `b` (required): the ends of the centre line. The wall must be horizontal or vertical and have a length.
- `thickness` (required): 20 to 1000.
- `id`, `name` (optional). A generated id is `wall`, then `wall-2`, `wall-3` and so on.
- `demolished` (optional): `true` only for `n` and `low` walls.

Refused: `wall-zero-length`, `wall-not-axis-aligned`, `thickness-out-of-range`, `wall-not-demolishable`.

```json
[{ "op": "add_wall", "id": "w2", "type": "n", "a": [4000, 200], "b": [4000, 4000], "thickness": 100 }]
```

#### `update_wall`

Changes the type, the thickness or the name of a wall.

- `wallId` (required).
- `type`, `thickness`, `name` (optional).

A new thickness keeps the centre line, so both faces move; room edges on a face can get a `room-edge-off-wall` warning. To move a wall, use `move_wall` or `move_wall_end`; to demolish it, use `toggle_demolition`.

Refused: `wall-demolished-type` (a demolished wall can only be `n` or `low`), `window-in-low-wall` (a wall with a window cannot become `low`), `thickness-out-of-range`.

```json
[{ "op": "update_wall", "wallId": "w1", "thickness": 240 }]
```

#### `delete_wall`

Deletes a wall **and the openings in it** (note `openings-deleted` with their ids).

- `wallId` (required).

Room edges on its faces get `room-edge-off-wall` warnings.

```json
[{ "op": "delete_wall", "wallId": "w1" }]
```

#### `move_wall`

Moves a whole wall.

- `wallId` (required).
- `by` (required): `[dx, dy]`.

The openings move with the wall: their offsets do not change. Room edges that lose the wall get `room-edge-off-wall` warnings.

```json
[{ "op": "move_wall", "wallId": "w1", "by": [0, -100] }]
```

#### `move_wall_end`

Moves one end of a wall along its line, to make the wall longer or shorter.

- `wallId` (required).
- `end` (required): `a` or `b`.
- `to` (required): the new point. It must be on the line of the wall (the same y for a horizontal wall, the same x for a vertical one).

The openings keep their position in the plan; when `a` moves, their offsets change to match.

Refused: `wall-end-off-line`, `wall-end-past-other` (the end would pass the other end; use `reverse_wall` to change the direction), `opening-outside-wall` (an opening would no longer fit).

```json
[{ "op": "move_wall_end", "wallId": "w1", "end": "b", "to": [9000, 100] }]
```

#### `split_wall`

Splits a wall in two at a point.

- `wallId` (required).
- `at` (required): a point on the centre line, between the ends.
- `newId` (optional): the id of the second piece. A generated one is the wall id with `-2` (or `-3`, and so on).

The first piece (from `a` to `at`) keeps the id. The second piece (from `at` to `b`) gets `newId`. Each opening goes to the piece that contains it; the note `wall-split` gives `newWallId` and `movedOpeningIds`.

Refused: `split-point-off-wall`, `split-point-in-opening`.

```json
[{ "op": "split_wall", "wallId": "w1", "at": [5400, 100], "newId": "w1b" }]
```

#### `join_walls`

Joins `otherId` into `wallId`.

- `wallId`, `otherId` (required).

The two walls must be on the same line, with the same type, thickness and demolition state, and touch or overlap. The joined wall keeps the id and the direction of `wallId`; `otherId` is removed. The openings keep their position in the plan; a door from a wall that ran the other way gets the other `hinge` and `swing` values, so it stays the same door. The note `walls-joined` gives `movedOpeningIds`.

Refused: `join-same-wall`, `walls-not-collinear`, `walls-type-differs`, `walls-thickness-differs`, `walls-demolition-differs`, `walls-not-touching`, `openings-overlap`.

```json
[
  { "op": "add_wall", "id": "w2", "type": "e", "a": [8000, 100], "b": [10000, 100], "thickness": 200 },
  { "op": "join_walls", "wallId": "w1", "otherId": "w2" }
]
```

#### `reverse_wall`

Swaps the ends `a` and `b` of a wall.

- `wallId` (required).

Each offset becomes `length − offset − width`, and each door gets the other `hinge` and `swing` values, so every opening stays in the same place.

```json
[{ "op": "reverse_wall", "wallId": "w1" }]
```

#### `toggle_demolition`

Marks a wall as demolished (planned for removal), or restores it. The openings in the wall stay (see "Openings").

- `wallId` (required).
- `demolished` (optional): `true` or `false`. Without it, the state switches.

Refused: `wall-not-demolishable` (only `n` and `low` walls can be demolished).

```json
[
  { "op": "add_wall", "id": "w2", "type": "n", "a": [4000, 200], "b": [4000, 4000], "thickness": 100 },
  { "op": "toggle_demolition", "wallId": "w2", "demolished": true }
]
```

### Openings

**Placement rules:** the opening is inside its wall (`offset` 0 or more, `offset + width` not more than the wall length), it does not overlap another opening in the same wall (openings can touch), the wall is not demolished, and a window is not in a `low` wall. Refused: `value-out-of-range` (a negative offset), `size-not-positive`, `opening-outside-wall`, `openings-overlap`, `wall-demolished`, `window-in-low-wall`.

**Height rules:** a window sill is 0 or more and below its head; every other head is 1800 or more; no head is above the ceiling. Refused: `height-out-of-range`, `window-sill-not-below-head`.

**Which command checks what:**

- `add_opening`, `move_opening`, `resize_opening` and `change_opening_type` check the placement rules and the height rules for the result. `move_opening` checks the wall that the opening moves to.
- `update_opening` checks only the height rules, and `field-not-for-type` (a field that the opening type does not have, for example `sill` on a door).
- `delete_opening` checks nothing more: it deletes any opening that exists.

**A problem that the plan already has:** a saved plan can already have an opening that breaks one of these rules (an overlap, a window in a low wall, a height out of range). A command does not refuse a problem that it does not make worse:

- An edit that does not touch the problem keeps it, for example a new `name`, or a move in the same wall that does not make an overlap longer.
- A height or an overlap can be made smaller in steps, but not larger. Example: under a 2800 ceiling, a head of 2900 can change to 2850, but not to 3000.
- A problem that the command makes is refused: a window moved into a low wall, a new overlap, or a type change to a window in a low wall. After a type change, the heights are checked as new.
- Each command is compared with the plan just before it, also in a batch.
- The error names the field that caused it, for example `wallId` for a move to another wall, or `type` for a default height that does not fit.

So an opening with a problem can still be changed, deleted, or moved to a place that keeps the rules. An opening in a demolished wall stays there (`toggle_demolition` does not remove it): `update_opening` and `delete_opening` work on it, `move_opening` can move it to a wall that is not demolished, and `resize_opening` and `change_opening_type` refuse it with `wall-demolished`.

#### `add_opening`

Adds an opening to a wall.

- `type` (required): `window`, `door`, `sliding-door` or `hole`.
- `wallId`, `offset`, `width` (required): the wall, the distance from its `a` end to the start of the opening, and the length along the wall.
- `id`, `name` (optional). A generated id is the type, for example `door`, then `door-2`.

The other fields depend on the type:

- For a `window`: `sill` (optional, default 900) and `head` (optional, default 2400).
- For a `door`: `hinge` (required: `start` is at `offset`, `end` is at `offset + width`), `swing` (required: `left` or `right` of the direction from `a` to `b`), `head` (optional, default 2100), `entry` (optional: `true` for the main door).
- For a `sliding-door` or a `hole`: `head` (optional, default 2100).

```json
[{ "op": "add_opening", "id": "d2", "type": "door", "wallId": "w1", "offset": 7000, "width": 900, "hinge": "end", "swing": "right" }]
```

#### `update_opening`

Changes the fields of an opening that do not change its place or type.

- `openingId` (required).
- `name`, `sill`, `head`, `hinge`, `swing`, `entry` (optional). Only `name` and `head` are for every type; `sill` is for a window, and `hinge`, `swing` and `entry` are for a door (`field-not-for-type` otherwise).

To move it, use `move_opening`; to change its width, `resize_opening`; to change its type, `change_opening_type`.

```json
[{ "op": "update_opening", "openingId": "win1", "sill": 800 }]
```

#### `delete_opening`

Deletes an opening.

- `openingId` (required).

```json
[{ "op": "delete_opening", "openingId": "hole1" }]
```

#### `move_opening`

Gives an opening a new offset, in the same wall or in another one.

- `openingId`, `offset` (required).
- `wallId` (optional): the new wall. Without it, the opening stays in its wall.

```json
[{ "op": "move_opening", "openingId": "d1", "offset": 7000 }]
```

#### `resize_opening`

Gives an opening a new width.

- `openingId`, `width` (required).
- `keep` (optional): the edge that stays in place, `start` (default, at `offset`) or `end`.

```json
[{ "op": "resize_opening", "openingId": "win1", "width": 1500, "keep": "start" }]
```

#### `change_opening_type`

Changes the type of an opening. The id, wall, offset, width and name stay; the fields of the old type that the new type does not have are removed.

- `openingId`, `type` (required).

The command must give all the fields of the new type:

- For a `window`: `sill`, `head` (required).
- For a `door`: `hinge`, `swing`, `head` (required) and `entry` (optional).
- For a `sliding-door` or a `hole`: `head` (required).

Refused: `opening-type-unchanged`, and the opening rules for the new type.

```json
[{ "op": "change_opening_type", "openingId": "hole1", "type": "window", "sill": 900, "head": 2400 }]
```

### Rooms

Rooms are not linked to walls. A room keeps its polygon when walls change; the wall commands warn about room edges that lose a wall.

#### `add_room`

Adds a room.

- `name` (required).
- `mat` (required): a key of `materials`. Add a material first with `set_material`.
- `poly` (required): the outline on the inside face of the walls, 3 or more points, with no crossing edges, and an area of 0.01 m² or more.
- `id` (optional). A generated id is `room`, then `room-2`.
- `at` (optional): the label position.
- `counted` (optional): `false` leaves the room out of the floor area.

Refused: `room-material-missing`, `room-too-few-points`, `room-self-crossing`, `room-area-too-small`.

```json
[{ "op": "add_room", "id": "r2", "name": "Bedroom", "mat": "wood", "poly": [[0, 4200], [4000, 4200], [4000, 7000], [0, 7000]] }]
```

#### `update_room`

Changes a room.

- `roomId` (required).
- `name`, `mat`, `poly`, `at`, `counted` (optional). The rules of `add_room` apply to the result, with one difference: a problem that the room already has stays if the command does not make it worse. A new `poly` must not cross itself, a new `mat` must exist, and an area below 0.01 m² can grow but not get smaller.

```json
[{ "op": "update_room", "roomId": "r1", "name": "Living room" }]
```

#### `delete_room`

Deletes a room.

- `roomId` (required).

```json
[{ "op": "delete_room", "roomId": "r1" }]
```

### Furniture

#### `add_furniture`

Adds an item.

- `type`, `name` (required). The editor knows types such as `sofa`, `bed`, `table`, `chair`, `wardrobe`; another type is drawn as a plain box.
- `cx`, `cy` (required): the centre.
- `w`, `d` (required): the width and depth, more than 0.
- `rot` (optional, default 0): the rotation in degrees.
- `id` (optional; a generated id is `furniture`, then `furniture-2`), `color` (optional).

Refused: `size-not-positive`.

```json
[{ "op": "add_furniture", "id": "f1", "type": "sofa", "name": "Sofa", "cx": 2000, "cy": 1500, "w": 2000, "d": 900 }]
```

#### `update_furniture`

Changes an item.

- `furnitureId` (required).
- `type`, `name`, `cx`, `cy`, `w`, `d`, `rot`, `color` (optional).

```json
[
  { "op": "add_furniture", "id": "f1", "type": "sofa", "name": "Sofa", "cx": 2000, "cy": 1500, "w": 2000, "d": 900 },
  { "op": "update_furniture", "furnitureId": "f1", "rot": 90 }
]
```

#### `delete_furniture`

Deletes an item. Its price in the cost estimate is removed too (note `furniture-price-removed`).

- `furnitureId` (required).

```json
[
  { "op": "add_furniture", "id": "f1", "type": "sofa", "name": "Sofa", "cx": 2000, "cy": 1500, "w": 2000, "d": 900 },
  { "op": "add_furniture", "id": "f2", "type": "armchair", "name": "Armchair", "cx": 4000, "cy": 1500, "w": 850, "d": 850 },
  { "op": "delete_furniture", "furnitureId": "f1" }
]
```

### The whole plan

#### `set_plan_name`

- `name` (required).

```json
[{ "op": "set_plan_name", "name": "Our apartment" }]
```

#### `set_material`

Adds a material, or replaces the one with the same key (note `material-created` or `material-replaced`). Rooms with that `mat` use the new values.

- `key`, `name` (required).
- `sw` (required): the colour, for example `#d8b88a`.
- `price` (optional): per m², 0 or more.

Refused: `value-out-of-range` (a negative price).

```json
[{ "op": "set_material", "key": "tile", "name": "Tile", "sw": "#e0e0e0", "price": 800 }]
```

#### `set_ceiling_height`

- `ceilingHeight` (required): 2000 to 6000, and not below the head of any opening (except a head that is already above the ceiling, see below).

Refused: `height-out-of-range`, `opening-head-above-ceiling` (lower that head first with `update_opening`). A head that is already above the ceiling does not block a ceiling that comes closer to it; a ceiling that goes further below it is refused.

```json
[{ "op": "set_ceiling_height", "ceilingHeight": 3000 }]
```

#### `set_dimensions`

Replaces all dimension chains of the plan (note `dimensions-set`, with the number of chains before and after). A chain has no id, so there is no command for one chain: to add or change one, read the `dimensions` of the plan, change the list and send the full list. An empty list removes all chains.

- `dimensions` (required): a list of chains. Each chain has these 4 fields, and no others:
    - `horizontal`: `true` for a chain along x, `false` for a chain along y.
    - `at`: where the line is drawn: its y for a horizontal chain, its x for a vertical one. It is best outside the walls; that is not checked.
    - `start`: where the first segment starts: an x for a horizontal chain, a y for a vertical one.
    - `segments`: 1 or more lengths, each more than 0, one after the other from `start`. The drawing shows each length as a number.

Refused: `dimension-no-segments`, `size-not-positive` (a length of 0 or less), `value-out-of-range` (`at`, `start` or the end of a segment is more than 1 000 000 mm from 0; the path names the value, for example `commands[0].dimensions[1].segments[0]`), `annotation-out-of-range` (a chain is more than 100 m outside the walls, rooms and furniture; in a plan with none of these, the box around all chains is more than 100 m on a side).

A chain that is more than 20 m outside the walls, rooms and furniture (or more than the longer side of their box, if that is more) is accepted with the warning `annotation-far-from-plan`: check the unit of your lengths.

Draw the plan with its dimension chains to check them. Do not invent a length: a chain repeats lengths of the plan, it does not correct them.

```json
[{ "op": "set_dimensions", "dimensions": [
  { "horizontal": true, "at": -600, "start": 0, "segments": [3000, 5000] },
  { "horizontal": false, "at": -600, "start": 0, "segments": [4000] }
] }]
```

#### `scale_plan`

Scales the whole plan, for example when the scale from the image was not correct. It has two forms:

- **By a factor:** `factor` (required, more than 0) and `pivot` (required: the point that stays in place).
- **By a known distance:** `a`, `b` (required: two points in the plan) and `distance` (required: the true distance between them, more than 0). The factor is `distance` divided by the distance from `a` to `b`, and the pivot is `a`.

A command with `factor` is read in the first form; a command without it, in the second form. So a command with `pivot` but no `factor` is refused with `command-field-unknown` for `pivot`.

Wall ends and thicknesses, openings along their walls, rooms, furniture positions, measurements and dimension chains scale. Furniture sizes, heights, door hinge and swing, materials and prices do not. Results are rounded to 0.1 mm. The note `plan-scaled` gives the factor and the pivot.

Refused: `size-not-positive`, `scale-points-same`, `scale-result-invalid` (the scaled plan would have errors, or be larger than 100 × 100 m, or a dimension chain would go more than 1 000 000 mm from 0 or get a length of 0). The issue `annotation-out-of-range` in that list means that a measurement or a dimension chain would be more than 100 m outside the walls, rooms and furniture, when it was not before, or farther than before; these limits are fixed lengths and do not scale with the plan. No command changes a measurement: if a measurement of the plan is already that far away, a larger scale is refused until the user deletes that measurement in the editor (or it is removed from the file).

```json
[{ "op": "scale_plan", "factor": 1.05, "pivot": [0, 0] }]
```

```json
[{ "op": "scale_plan", "a": [0, 100], "b": [8000, 100], "distance": 8200 }]
```

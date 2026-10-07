# Open Plan format (schemaVersion 2)

A plan is one JSON object. Units are millimetres. x goes right and y goes down, the same as an image.
The full structural rules are in [`open-plan.schema.json`](open-plan.schema.json).

## Fields

- `schemaVersion`: always `2`. `units`: always `"mm"`. `id`, `name`: text.
- `ceilingHeight` (optional, default 2800): 2000 to 6000.
- `walls`: each wall is the **centre line** from `a` to `b` (`[x, y]` points) and a `thickness` (20 to 1000). The body extends half the thickness on each side, not past the ends. A wall is horizontal or vertical. `type` is `e` (exterior), `b` (bearing), `n` (partition) or `low` (low wall). Optional `demolished: true` is for `n` and `low` walls only.
- `openings`: each opening is in one wall. `wallId` names the wall; `offset` is the distance from the wall's `a` end to the start of the opening, along the wall; `width` is its length along the wall. `offset + width` is not more than the wall length, and openings in one wall do not overlap. `type` is:
    - `window`: `sill` (default 900) and `head` (default 2400), with sill below head.
    - `door`: `hinge` is `start` (at `offset`) or `end` (at `offset + width`); `swing` is `left` or `right` of the direction from `a` to `b`; `head` (default 2100). Optional `entry: true` for the main door.
    - `sliding-door` and `hole`: `head` (default 2100).
    - Every head is 1800 or more (windows excepted) and not above the ceiling. Optional `name`.
- `rooms`: `poly` is the room outline on the inside face of its walls (3 or more points, no crossing edges). `mat` is a key of `materials`. Optional `at` (label position) and `counted: false` (not in the floor area).
- `materials`: an object of `{ "name": text, "sw": colour }`, keyed by the `mat` values.
- `furniture`: `cx`, `cy` (centre), `w`, `d` (size, above 0), `rot` (degrees), `type`, `name`, optional `color`. Use `[]` for none.
- Optional: `measurements`, `dimensions` (dimension chains), `costEstimate`.
- Every `id` is unique in its list. The plan is at most 100 × 100 m.

## Example

One continuous wall, 8 m long and 200 mm thick, with four openings. The room is below the wall on screen, which is the wall's right side.

```json
{
  "schemaVersion": 2,
  "id": "example",
  "units": "mm",
  "name": "My apartment",
  "ceilingHeight": 2800,
  "walls": [
    { "id": "w1", "type": "e", "a": [0, 100], "b": [8000, 100], "thickness": 200 }
  ],
  "openings": [
    { "id": "win1", "type": "window", "wallId": "w1", "offset": 500, "width": 1200, "sill": 900, "head": 2400 },
    { "id": "d1", "type": "door", "wallId": "w1", "offset": 2200, "width": 900, "hinge": "start", "swing": "right", "head": 2100 },
    { "id": "s1", "type": "sliding-door", "wallId": "w1", "offset": 3600, "width": 1600, "head": 2100 },
    { "id": "hole1", "type": "hole", "wallId": "w1", "offset": 5800, "width": 1200, "head": 2400 }
  ],
  "rooms": [
    { "id": "r1", "name": "客廳", "mat": "wood", "poly": [[0, 200], [8000, 200], [8000, 4000], [0, 4000]] }
  ],
  "materials": { "wood": { "name": "橡木地板", "sw": "#d8b88a" } },
  "furniture": []
}
```

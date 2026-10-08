# Plan import roadmap

As of 2026-10-06. Status: **proposal, no code written**.

## Summary

Open Plan shows only one hard-coded apartment. For public users, a plan must come from data that the user supplies. The proposal: the user gives a floor-plan image to **their own AI agent** (Claude, Codex, Gemini or other), the agent writes **Open Plan JSON**, and the user imports that file. The app validates the file, shows the image under the plan, and lets the user correct errors.

Open Plan is also **a tool for agents**. Agents with a shell (Claude Code, Codex, Gemini CLI, Cursor, OpenCode) work on a **plan file** with a local CLI and a local MCP server: they validate, draw and change the plan, and the browser shows the same file live (Step C).

- **Why the user's agent:** Open Plan pays nothing for image recognition, needs no server, and works with every agent that can read images.
- **Main risk:** agents often get the shape correct but the **scale** incorrect. Calibration and a background image (Step D) reduce this risk.
- **Order:** A (geometry contract and data-driven app) → B (safe replacement, validation, import, schema, agent prompt) → C (agent access: core package, CLI, live file mode, agent guide, local MCP) → D (background image, calibration, editing) → E (remote MCP server, later). Each step is useful alone.
- **Do not publish the schema before Step A is done.** Step A changes the wall and opening format, and a published format is hard to change.

### Revision history

- **v1 (2026-10-06):** first proposal.
- **v2 (2026-10-06):** review changes. A geometry contract with continuous walls and linked openings; explicit heights for all openings and the ceiling; safe replacement of the open plan; a structured validation contract; calibration with plan anchors and a list of the fields that scale; bounds that include all content, an empty-plan fallback and 3D limits for large plans.
- **v3 (2026-10-06):** walls become **centre lines with a thickness**, and openings become an **offset and width along their wall**. Door hinge and swing become two enums. The format can describe diagonal walls; this phase still accepts only axis-aligned walls.
- **v4 (2026-10-06):** new **Step C, agent access** (core package, CLI, live file mode, agent guide, local MCP server). The old Steps C and D become D and E. Steps A and B write the migration, validator and commands in the core package.
- **v5 (2026-10-06):** review changes. The migration makes one wall piece per opening and merges nothing (the merge rule fitted only 7 of the 20 sample openings). An exact door hinge formula. Wall type and demolition rules for generated pieces. A validation policy by source, with render-blocking errors that are never warnings. Wall edit rules in the core package. Locked, atomic file writes and a weaker, stated guarantee for direct file edits. Separate schema and semantic tests. Scaling that is refused when invalid and that moves the background image too. Image identity and storage for both modes.
- **v6 (2026-10-06):** open questions resolved into decisions and tasks: empty first plan, mode-aware privacy text, separate storage modes with a visible mode indicator. Shadows wait for the 100 × 100 m test. The package name stays open; examples use placeholders.
- **v7 (2026-10-06):** new **Repository structure** section (pnpm monorepo: `apps/web`, `packages/core` in TypeScript, `packages/cli` in Step C; Vitest) and new **A0, relocation** with baseline screenshots before any geometry change.
- **v8 (2026-10-06):** review changes. A guarded migration rule for the two sample bay-window holes. File mode: reload of a file that is valid again respects unsaved edits; "保留我的版本" uses the last seen revision and backs up the external version; a backup folder written under the same lock as each write; one recovery snapshot per session before the first autosave, in both modes. `update_wall` and `update_opening` accept only safe fields, with named commands for the rest. Screenshot stability settings for A0.
- **v9 (2026-10-06):** migration review: input check with `MigrationError`, unique generated ids, the exact rule for what blocks the bay-window holes, and input versus normalized v2 types.

## Repository structure

A **pnpm monorepo**. The repo has no commits yet, so the move costs no history.

```
open-plan/
├─ apps/
│  └─ web/              the editor: Vite + React, JavaScript (not published)
├─ packages/
│  ├─ core/             TypeScript: schema, validator, migration, geometry, commands, 2D SVG
│  └─ cli/              Step C: CLI, `serve` and the local MCP server
├─ docs/
├─ donor/, reference/   unchanged, ignored by git
├─ package.json         private root, name `open-plan-workspace`: workspace scripts only
└─ pnpm-workspace.yaml  packages: apps/*, packages/*
```

- **Languages:** `packages/core` is **TypeScript**, because agents and other developers use its interface. `apps/web` stays JavaScript for now. `packages/cli` language is decided in Step C.
- **Core exports:** `core` publishes **compiled JavaScript and type declarations** through the `exports` field of its `package.json`. The web app and the CLI depend on it with `workspace:*` and import only this public interface, never files inside `core/src`.
- **Build order:** `core` → `web` → `cli`. In Step A and Step B, only `core` → `web` exists. `packages/cli` is created in Step C, because an empty CLI package has no use before then.
- **Bundled editor (Step C):** `apps/web/dist` is generated output and is not committed. The `cli` build copies it into the CLI package. Vite asset paths must work when `serve` delivers the editor (relative `base`, or the path that `serve` uses). The Step C tests also install the **packed** CLI (`pnpm pack`) in a folder outside the repository and run it there.
- **Tests:**
    - **Vitest** covers `core` logic: validator, migration, geometry, commands.
    - **Browser checks** (pixel compares, editor behaviour) use a separate browser harness with headless Chrome, as in the defect review. Vitest does not run them.
- **Package names:** the root becomes `open-plan-workspace` (private). The names of the packages that will be published stay open until a usable scope is chosen (see Decisions and open questions). Inside the workspace, temporary private names are used.

## Current blockers

The seed data is only one part. These parts of the code also assume the reference apartment. Locations are `path:line` on 2026-10-06, relative to `apps/web/src/floorplan/` (before A0 the same files were in `src/floorplan/`).

| Blocker | Location | Effect with a different plan |
| --- | --- | --- |
| Walls must stop at each opening | `seed.js:3`, `three/models.js:696` | A wall that crosses an opening draws as a solid box over the window or door |
| Fixed 3D centre (6000, 5300 mm) | `three/coordinates.js:2`, `:3`, `:5`; `three/viewer.js:143` | The 3D model is off-centre |
| Fixed 3D camera, orbit, shadow and ground | `three/viewer.js:38`, `:39`, `:44`, `:46` | Max orbit distance 60 m, shadows only in ±11 m, ground 100 × 100 m |
| Fixed 2D bounds (15600 × 14100 mm) | `usePlanViewport.js:6` | "Fit" and the default zoom do not show the plan |
| Fixed lintel positions (two bay-window holes) | `three/models.js:702` | Lintels appear in empty space |
| Window sill height from the list index | `three/models.js:705` | Windows get incorrect sill heights |
| Sliding-door head height from `v` (orientation) | `three/models.js:702` | Height depends on the door direction, not on data |
| Fixed ceiling height 2.8 m | `three/models.js:8` | Pendant lights and heads cannot follow a different ceiling |
| Reference dimension chains | `dimensions.js` (`REFERENCE_DIMENSIONS`) | The dimension lines describe the old apartment |
| Seed is the only start point | `document.js:6` (`createDocument`) | No empty plan; no way to load another plan |
| No JSON import | `FloorPlanEditor.jsx` (export only) | An exported plan cannot be loaded again |
| `validateDocument` returns only true or false | `document.js:26` | No message can say what is wrong or where |
| No wall or opening editing; only "demolished" | `WallProperties.jsx` | The user cannot correct the agent's errors |
| Openings are not linked to walls (L10) | `document.js`, `Measurements.jsx:12` | Moving or demolishing a wall leaves its door in place |

### Diagonal walls

- **Format:** ready. A wall is a line between two points, so it can have any angle.
- **This phase:** the validator rejects a wall that is not horizontal or vertical (code `wall-not-axis-aligned`). The renderer, snapping, measuring and dimension code keep working on axis-aligned rects that are made from the lines.
- **Later:** diagonal support needs rotated 3D walls and openings, mitred corners, furniture snapping to an angled face, and 2D hit testing for rotated walls. It needs **no schema change**: remove the validator rule when the renderer is ready.
- Curved walls are out of scope.

## Step A: geometry contract and data-driven app

**Goal:** any valid plan shows correctly in 2D and 3D. The reference apartment stays as a sample and looks the same as now.

**Code location:** write the migration, the wall-to-rect conversion and the bounds calculation in the framework-free core package (see C1), not in React components. Step C then reuses them with no change.

### A0. Relocation (before any geometry change)

Move the files first, and change no behaviour. A regression is then either from the move or from a later geometry change, never from both together.

1. Build the current app and capture **baseline screenshots** with the browser harness: 2D and 3D of the sample at 1440 × 900 and 1024 × 768, with the default camera; 3D at cut heights 0.9 m and 2.8 m (6 screenshots). The bearing-wall layer is not varied, because it has no visible effect yet (L16). Harness: `tools/visual/capture.mjs` and `compare.mjs`; output in `tools/visual/out/` (not committed).
    - **Stable settings:** record the Chrome version with the baseline; a compare with a different version stops with a clear message. Device scale factor 1, a fixed viewport, the SwiftShader 3D flags (`--use-angle=swiftshader --enable-unsafe-swiftshader`), reduced motion, empty browser storage.
    - **Readiness:** wait for `document.fonts.ready`, then for the 3D view to draw several frames with no pending textures. The 3D textures use seeded random numbers (`rng` in `three/models.js`), so they are the same on each run.
2. Move the app to `apps/web`, add `pnpm-workspace.yaml` packages, rename the root to `open-plan-workspace`, and add Vitest.
3. Create an empty `packages/core` with its TypeScript build and exports, and import one small function from it in the web app, to prove the link.
4. Build `core` → `web`, and compare with the baseline. **The screenshots must be the same.** Only then start A1.

### A1. Wall and opening contract (decide first)

**Walls are continuous centre lines.** Each opening is **linked** to one wall by an offset along it. The renderer makes the wall pieces around each opening, the sill under a window and the lintel above every opening. This also resolves design decision L10.

**Wall:**
- `a`, `b`: the two end points of the **centre line**, in mm. `a` and `b` are different.
- `thickness`: in mm, 20–1000.
- The wall body is the line, extended by `thickness / 2` on each side. It is **not** extended at the ends. Corners are made by walls that overlap at their ends, as in the sample now.
- `type`: `e` exterior, `b` bearing, `n` partition, `low` low wall. Only `n` and `low` can be marked demolished.
- **Direction:** "along the wall" means from `a` to `b`. The **right side** is the direction turned 90° clockwise **on screen** (y goes down): for a direction `(dx, dy)`, the right normal is `(-dy, dx)`. Example: for a wall from left to right, the right side is down on the screen.

**Opening:**
- `wallId`: the wall that holds it. Required.
- `offset`: the distance in mm from `a`, along the wall, to the start of the opening. `width`: its length along the wall.
- Valid when `offset ≥ 0`, `width > 0` and `offset + width ≤` wall length. An opening always has the full wall thickness, so it cannot point outside its wall.
- Types: `window`, `door`, `sliding-door` and `hole` (an empty opening with no door or window, for example the bay-window holes in the sample).
- **Door only:** `hinge` is `start` (the hinge is at the `offset` end) or `end` (at `offset + width`). `swing` is `left` or `right`: the side of the wall the door opens to. The leaf length is `width`. This replaces the v1 fields `h`, `c`, `o` and `len`.
- **Hinge point (exact):** the hinge is on the wall **face on the swing side**. With `u` = the unit direction from `a` to `b`, `n` = the right normal of `u` (`n = (-u.y, u.x)`), `s` = +1 for `swing: right` and −1 for `left`, and `t` = `offset` for `hinge: start` or `offset + width` for `hinge: end`: **hinge = a + t·u + s·(thickness / 2)·n**. The closed leaf lies along the face toward the other end of the opening. The open leaf points along `s·n`. All 6 sample doors follow this rule (checked on 2026-10-06).
- **Sliding door:** the v1 field `v` is removed. The wall direction gives the orientation.
- Openings in one wall must not overlap.
- Optional: `name`; `entry: true` on the entrance door.

**Behaviour:**
- In 2D, the wall is drawn with a gap at each opening, and the opening symbol is drawn in the gap.
- In 3D, each wall becomes: the pieces between openings at full height, a sill piece under each window (0 to `sill`), and a lintel piece above each opening (`head` to the ceiling).
- **Sill and lintel pieces use the plain wall material**, as now, whatever the wall type: they are not drawn black for a `b` wall. In a `low` wall, sills are cut at the low-wall height and no lintel is drawn.
- Internally, the app makes an axis-aligned rect for each wall and each opening from the line data. Snapping, measuring and hit testing use these rects, so most current code does not change in this phase.
- A demolished wall takes its openings with it: they are not drawn and are not snap targets. The opening data stays, so "restore wall" brings them back.
- **Schema version:** this changes `walls` and `openings`, so the new format is **`schemaVersion: 2`**.

**Migration of v1 documents (the sample and saved plans):**
- **Walls:** each v1 `rect` becomes a centre line along its longer side, with the shorter side as `thickness`. A square rect becomes a horizontal line. Wall ids, types and demolition state do not change.
- **No merge.** In the sample, only 7 of the 20 openings have walls of the same type on both sides (checked on 2026-10-06): 1 has mixed types (slide-1: `low` and `n`), 5 have a wall on one side only, and 7 have no exact neighbour (most touch a corner wall of a different size). So each v1 opening gets **its own new wall piece** with the opening's rect, and the opening fills it (`offset: 0`, `width` = the piece length). This covers all cases, and every rect stays the same as in v1.
- **Type of a generated piece:** the type of the walls that touch its two ends, if they agree. If they do not agree, the full-height type, in the order `b`, `e`, `n`, `low`. With no touching wall at an end, the nearest wall that touches the piece. With no wall at all, `n`. Every choice is recorded in the migration report.
- **Effect of the type:** a generated piece is all opening, so its type has no effect on the 3D heights or material (see the sill and lintel rule above). It controls only whether the piece can be demolished, and the name in the properties panel. A piece that gets `low` from two `low` neighbours (none in the sample) loses its lintel; the report lists it.
- **Demolition state of a generated piece:** always `false`, because v1 always draws its openings. If a touching wall is demolished, the report lists it, and the user decides.
- **Doors:** `hinge` is `start` or `end`, from the end of the opening where `h` is. `swing` is `right` if `o` equals the right normal, otherwise `left`. The hinge formula must give back the v1 `h` exactly; if it does not, or if `c` does not point from the hinge into the opening, the report lists the door.
- **Sample bay-window holes (sample-specific rule):** in v1, the two holes in the wall line x 10270–10510 (y 800–2600 and y 4260–5740) exist only as lintel coordinates in the renderer, not in the document. The migration creates them as two `hole` openings, each in its own wall piece, head 2400. Piece types from the type rule: `e` for the first, `b` for the second.
    - **Guard:** the rule runs only when the four end pieces exist exactly (`e [10270,300,10510,800]`, `e [10270,2600,10510,3090]`, `b [10270,3090,10510,4260]`, `b [10270,5740,10510,6370]`) **and no wall rect or opening rect overlaps the inside of either gap** (touching a gap's edge is allowed, because the end pieces touch it). Rooms, furniture, measurements and dimensions do not block the rule: the sample's bay-window rooms cover the gaps by design. Otherwise the plan gets no holes, and the report says why.
    - The report marks these two holes as "sample-specific".
- **Joining** a generated piece with its neighbours into one continuous wall is a user action (`join_walls`, C1), not part of the migration.
- The undo history starts empty after migration.
- **Input check first:** the v1 validator accepts data that the migration cannot read (for example an unknown opening type such as `archway`, a door without `h`, duplicate wall ids, or a reversed rect). The migration checks its input first and stops with a `MigrationError` (`code` and `path`), with no change. At load this follows the H2 path.
- **Generated ids** (wall pieces, bay-window holes) are always unique: `base`, then `base-2`, `base-3` and so on.
- The migration runs at load. Before it, the raw v1 data is copied to its own key (`open-plan:document:v1:before-v2`), which v2 saves never overwrite. If that copy cannot be written, the plan is not migrated and the load fails safely (H2 path).

### A2. Height contract

All heights are in mm and are stored in the plan, not in code.

| Field | Where | Default | Valid range |
| --- | --- | --- | --- |
| `ceilingHeight` | plan | 2800 | 2000–6000 |
| `sill` | window | 900 | 0 ≤ sill < head |
| `head` | window | 2400 | sill < head ≤ ceilingHeight |
| `head` | door, sliding-door, hole | 2100 | 1800 ≤ head ≤ ceilingHeight |

- The **wall height control in the 3D view is a view setting** (a cut height). It stays separate from `ceilingHeight`, and its maximum becomes `ceilingHeight`.
- **The sample gets its current heights as explicit data** in the migration: window 0 sill 1400; bay windows (index 6 and higher) sill 450; other windows sill 900; all windows head 2400; the vertical sliding door head 2400 and the horizontal one 2100; doors head 2100; the two bay-window holes head 2400; ceiling 2800.

### A3. Bounds, empty plans and 3D limits

- **Two kinds of bounds** (`packages/core/src/bounds.ts`):
  - **Content bounds:** walls, openings, rooms, furniture (rotated bounds), measurements and dimension chains. This is all that 2D shows.
  - **Physical bounds:** walls, rooms and furniture only, with no measurements or dimension chains. This is all that 3D draws.
- **Fit area (2D):** the content bounds plus a margin on each side. The margin on the left and on the right is each 10% of the content width, or 500 mm if that is larger. The margin at the top and at the bottom is each 10% of the content depth, or 500 mm if that is larger. Example: content 14 550 mm wide gets 1455 mm on the left and 1455 mm on the right.
- **Empty plan:** use a default area of 10 × 8 m with its centre at (0, 0).
- **Furniture-only plan:** the bounds come from the furniture.
- **2D:** "Fit" and the default zoom use the fit area. The fit area is set when a plan loads, and "Fit" goes back to it.
- **3D frame** (`packages/core/src/view-frame.ts`): the scene origin is the centre of the physical bounds. The camera reset position, orbit target, maximum orbit distance, far plane, ground size and shadow camera come from the physical bounds and the effective ceiling height.
- **When the 3D frame changes:** only when a plan loads (first view or a different plan ID) and when the user clicks "Reset view". Edits, such as a furniture drag, do not move the frame, so the scene does not jump during or after a drag.
- **Translation:** floor patterns are anchored at each room's top-left corner, and the random details of a furniture model come from its ID. So a moved plan looks the same.
- **Large plans:** the shadow map has a fixed size, so shadows get softer on large plans. Accept this up to 100 × 100 m, and record the result. If it looks unacceptable, switch shadows off above a set size.
- Move `wx`, `wz` and `planPoint` from constants to the viewer state.
- Make dimension chains optional. A plan without them shows no dimension lines (checked in `tools/checks/bounds.mjs`). Automatic chains are later work.

### Step A done when

- **Relocation (A0):** after the move, the screenshots are the same as the baseline taken before the move.
- **Sample:** after migration, the sample looks the same as the baseline in 2D and 3D (pixel compare in the browser harness, same camera).
- **Migration:** a Vitest test converts the sample and converts the internal rects back. Every wall and opening rect is the same as in v1. The hinge formula gives back the v1 `h` for all 6 doors, and the swing matches `o`. Every generated piece has the type from the rule, `demolished: false`, and a report line.
- **Sample heights:** the 3D pixel compare passes at cut heights 0.9 m and 2.8 m, so wall types on generated pieces change no rendered height or colour. When the bearing-wall layer gets a visible effect (L16), add it to the compare.
- **Opening holes:** a test plan with one continuous wall and a window, a door, a sliding door and a hole shows four real holes in 3D, with correct sill and lintel heights. Check: `tools/checks/openings.mjs` (at the full cut height, each point 100 mm inside an opening differs from a solid wall, and each point 100 mm below a sill, above a head or beside an opening is identical to it).
- **Offset:** a plan moved by (+20000, +20000) mm looks the same as the original, and furniture still snaps flush to a moved wall with a 2D drag and with a 3D canvas drag (the 3D result is exactly the unmoved result + 20000 mm). The 3D frame does not change during or after a drag, and "Reset view" moves it to the new bounds. 3D is pixel-identical. In 2D, every element has the same screen box (to 0.01 px), and at most 0.25% of pixels change: Chrome rounds text and edges at the sub-pixel level from the absolute coordinates, so exact pixel identity is not possible there. Check: `tools/checks/bounds.mjs`.
- **Size:** a 3 × 4 m room, a 30 × 20 m plan and a 100 × 100 m plan all fit the screen in 2D and 3D, and orbit can show the whole plan. Zoom out always shows a larger area: the minimum 2D scale is half the fit scale when that is below 0.012.
- **Repeatable captures:** sample furniture has fixed IDs (3D details are seeded from the ID), so two independent captures are identical.
- **Large-plan shadows:** for the 100 × 100 m plan, record shadow softness, visible artifacts (acne, banding, missing shadows at the edges) and frame rate. Then decide: keep shadows, or switch them off above a set size.
    - **Result (2026-10-07), headless Chrome 155, SwiftShader (software WebGL), 1440 × 900 at device scale 2, full cut height, PCF soft shadows, 2048 px shadow map.** Record: `tools/visual/shadows.mjs` (images and numbers). A GPU can draw the shadow filter differently, so check again on real hardware before a release.
    - **Softness:** one shadow texel is 8.6 mm on the sample and 69.3 mm on the 100 × 100 m plan (shadow box 17.5 m and 141.8 m wide). On the large plan, the wall shadows on the floor are wide, soft bands with no sharp edge; on the sample they are clearly sharper. In both, floor shadows are faint, because the hemisphere light is strong.
    - **Artifacts:** none seen in the default, centre and near-corner views: no acne (stripes on lit faces), no banding, and no gap between a wall and its shadow.
    - **Edges:** the tested east edge retains its shadow: the shadow that the east perimeter wall casts onto the ground outside the plan has the same strength on the 10 × 10 m and the 100 × 100 m plan (7.8 of 255 brightness against open ground). The other edges were seen in the images but not measured. Interior shadow strength was not measured: from the default camera, most interior wall shadows are hidden behind their walls.
    - **Frame rate** (1440 × 900, device scale 1): sample 4.5 fps, 100 × 100 m plan 27.6 fps (`tools/checks/bounds.mjs`).
    - **Decision:** keep shadows at all plan sizes.
- **Edge cases:** an empty plan and a furniture-only plan open with no error, and "Fit" works.
- **Demolition:** demolishing a partition wall with a door removes the door hole and the door in 2D and 3D. Restoring the wall brings both back.

## Step B: safe replacement, validation and import

**Goal:** a user can turn an image into a plan with any agent, with no server, and can never lose the open plan by doing so.

### B1. Safe replacement of the open plan

This applies to **Import**, **New empty plan** and **Load sample apartment**.

- Before the replacement, serialize the **current in-memory document** (the latest editor state, not the copy in localStorage) to a backup key.
- If the backup write fails (for example, storage is full), **stop the replacement**. Show the error and offer to download the current plan as JSON.
- After the replacement, show a status with a **復原上一個平面圖** action. It restores the backup. It stays available until the next replacement.
- The replacement is also one step in the undo history, for the current session.
- The existing H2 recovery copy (for unreadable saved data at load) stays separate and is not changed.
- **Before the backup:** a focused field is committed, and a measurement, pan or furniture/label drag is ended. A drag that is not finished is cancelled, so the backup has the plan from before the drag.
- **3D drag:** a plan swap (replace, restore, undo, redo, history restore) ends a 3D drag directly, without waiting for a render. It also increases a plan generation number. A 3D drag takes this number when it starts, and the editor drops a move with an old number. The plan ID cannot do this: a second restore of the same backup keeps the plan ID, and the sample has fixed item IDs. The 3D view can release the pointer before it renders the new plan.
- **Implementation (B1):** backup key `open-plan:document:v1:replaced`. **New empty plan** and **Load sample apartment** are in the plan panel. Restore reads the backup and keeps it, and is one undo step. The replacement clears the selection and fits the new plan. After a load error (autosave paused), replacement does not resume autosave.

### B1 done when

`tools/checks/replace.mjs` passes. It covers: an edit less than 400 ms old is in the backup and comes back with restore; a focused field is committed; 2D and 3D drags in progress are cancelled, and a 3D release that arrives before or after the 3D view renders the new plan moves nothing, also for a restore that keeps the plan ID; a failed backup changes neither the plan nor the undo history and offers a download; restore keeps the backup and works again; the selection is cleared and the new plan fits; the H2 recovery copy is not changed.

### B2. Validation contract

One validator is used for saved documents at load, for imports, by the CLI and MCP tools (Step C), and as the source for the published JSON Schema. It lives in the core package (C1).

- **Two type levels:** `PlanV2Input` is what an import or a plan file may contain; heights and `ceilingHeight` are optional. `PlanV2` is the normalized plan that the app and the commands use; every height is present. The validator turns valid input into a `PlanV2` by filling the A2 defaults. Exports write the normalized form.
- **Result:** `{ ok, errors: [{ path, code, params }], warnings: [...] }`. Example: `{ path: "openings[2].width", code: "opening-outside-wall", params: { wallLength: 3000 } }`.
- **Messages:** the UI makes zh-TW text from `code` and `params`, for example "第 3 個開口：超出牆的長度 3000 mm". The user can paste the message back to the agent. Show the first 20 errors and the total count.
- **Rules:**
    - Required fields and types, as now.
    - Enums: wall `type` is `e`, `b`, `n` or `low`; opening `type` is `window`, `door`, `sliding-door` or `hole`; door `hinge` is `start` or `end`; door `swing` is `left` or `right`; `units` is `mm`.
    - Walls: `a` and `b` are different; `thickness` is 20–1000; **the wall is horizontal or vertical** (this phase only, code `wall-not-axis-aligned`).
    - Openings: `wallId` exists; `offset ≥ 0`, `width > 0`, `offset + width ≤` wall length; no overlap with other openings in the same wall.
    - Heights: the ranges in A2. A height that is left out is checked with its default, so the normalized plan gives the same result as its input.
    - Walls: only `n` and `low` walls can be `demolished` (code `wall-not-demolishable`).
    - Rooms: `mat` exists in `materials`; the polygon has at least 3 distinct points, an area larger than 0.01 m², and no self-crossing.
    - Ids are unique in each list.
    - Size: the plan is not larger than 100 × 100 m; at most 2,000 walls, 2,000 openings, 500 rooms and 5,000 furniture items.
- **Two classes of rule:**
    - **Errors that block rendering** are errors for every source and every version: missing or wrong-type fields, numbers that are not finite, unknown enums, duplicate ids, a `wallId` that does not exist, a zero-length wall, thickness out of range, an opening outside its wall length, a room polygon with fewer than 3 points.
    - **Tolerable issues** can be shown and edited safely: self-crossing or very small room polygons, overlapping openings in one wall, a room `mat` with no material (drawn with a default material), heights out of range (drawn clamped), a plan larger than the size limits, a window in a `low` wall (its glass stands above the low wall), a demolished bearing or exterior wall (drawn as demolished; the editor can restore it, but not demolish it again).
- **Policy by source, not by version:**
    - **Saved plans** (localStorage, or the file in `serve`): tolerable issues are **warnings**, in v1 and in v2, so a plan that loaded before a save also loads after it. Errors that block rendering follow the H2 path: the data is kept in the recovery copy and the plan does not open.
    - **Import, CLI `validate`, MCP `validate_plan` and `migrate_plan`:** tolerable issues are **errors**. The agent or the user must correct them.
    - **Editing commands** (C1: CLI `apply`, MCP `apply_commands`, the editor): the result is validated with the **saved** policy, so an existing tolerable issue does not block an unrelated edit. Each command still **refuses the outcomes that it forbids** (see C1), even when the validator would only warn.
- **The migration repairs nothing silently.** It only changes the format and reports what it found.
- **Schema file:** `docs/open-plan.schema.json` covers the **structural** rules (fields, types, enums, ranges of single values). Rules that need more than one value (references, overlap, polygon crossing, opening inside the wall length) are **semantic**. The schema description lists them, and only the validator checks them.
- **Two test sets:** structural fixtures, where the schema and the validator must give the same pass or fail; and semantic fixtures, which pass the schema and must fail the validator with the expected `code` and `path`.

**Implementation (B2):**

- **Core:** `validatePlan(input, source)` in `packages/core/src/validate.ts`, with `source` `saved` or `import`. It collects every issue, not only the first. `TOLERABLE_CODES` lists the tolerable codes; every other code blocks rendering. `validateSharedFields` checks the shared fields of a v1 plan before migration. `checkPlanV2` is removed.
- **Size:** measured on wall centre lines, room points and furniture boxes, so a 100 × 100 m plan between wall centre lines is not too large.
- **Unknown fields** are allowed and kept, in the schema and in the validator.
- **Drawing tolerable issues:** opening heights are drawn clamped (`effectiveOpeningHeights`): a window to 0 ≤ sill ≤ head ≤ ceiling, other openings to 1800 ≤ head ≤ ceiling. The stored values are kept.
- **Editor:** a saved plan with warnings opens with a notice; the plan panel lists the warnings of the open plan (checked after each change) and, after a load error, the errors of the saved data. Each message ends with the raw path. The first 20 are listed, then the count.
- **Checks:** `packages/core/test/validate.test.ts` (structural and semantic fixtures, with the schema compiled by Ajv) and `tools/checks/validation.mjs` (the saved policy in the browser).

### B3. Import, schema and agent prompt

- **First plan:** a new user sees an **empty plan** with prominent **Import plan** and **Load sample apartment** actions. A returning user reopens their saved plan.
- **Import:** a button and drag-and-drop for a `.json` file. Validate it, then show a summary before the replacement: counts of walls, openings, rooms and furniture, and the plan size in metres. The replacement then follows B1.
- **v1 files** (for example older exports) are migrated with the A1 rules, and the migration report is shown.
- **Published description:** a short Markdown page with the field meanings and one small example plan.
- **Agent prompt:** a copy button in the app with the prompt below.
- **Privacy text** (task), beside the agent prompt and beside image import (D1), in zh-TW in the UI: "Open Plan does not upload your image. Website mode stores it in this browser; local file mode stores it on your computer. If you give the image to an AI agent, that agent handles it."
- This step also lets you **move a plan between computers** (export on one, import on the other).

**Implementation (B3):**

- **First plan:** with no saved plan, the editor opens an empty plan. On the canvas, a card offers 匯入平面圖, 載入範例公寓 and 複製 AI 提示. It goes away when the plan has walls, rooms or furniture. A saved plan that cannot load (H2) also opens an empty plan, no longer the sample.
- **Import entry points:** 匯入 in the header, 匯入平面圖（JSON） in the plan panel, the empty-plan card, and a file dropped anywhere on the workspace (an overlay shows while a file is over it). Only drags that carry files are taken. Files over 20 MB are refused before they are read.
- **Reading:** `apps/web/src/floorplan/planFile.js`. `readImportFile` parses the text, migrates a v1 file with the A1 rules (`migrateV1Document`, also used by storage), and validates with the **import** policy. A v1 file is first checked with the v1 rules and then validated as v2, so a tolerable issue in a v1 file is also an import error.
- **Dialog:** on success, the counts, the size in metres (`summarizePlan` in core, from `contentBounds`), the v1 report grouped by code (zh-TW text, the English note below it), and the note that the current plan is backed up first; 取代目前平面圖 replaces through B1. On failure, the first 20 errors and the count, and 複製錯誤訊息 copies all errors with their paths. Escape, 取消 and 關閉 close it, and the plan does not change. The dialog is modal: the header, the workspace and the cost panel are inert, Tab and Shift+Tab wrap inside it, the editor's shortcuts do not act, and focus goes back to the control that opened it.
- **Late file reads:** each import request has a number, and only the newest request can show its result, success or failure. 取消 and 取代目前平面圖 end every pending read, so a slow file cannot replace a newer preview or open a dialog after it closes.
- **Plan id:** import keeps the id of the file, so an export imports again with no change. A replacement or restore is therefore counted (`planLoads`), and the 2D fit and the 3D frame use the key `id:count`, not the id alone. An import of the same plan fits the view and resets the 3D camera.
- **Published description:** `docs/plan-format.md` (the field meanings and the example above, with an `id`, which the schema requires). A Vitest test checks that its example passes the schema and the import validator with no issue.
- **Agent prompt:** `apps/web/src/floorplan/agentPrompt.js`: the draft prompt below, plus "reply with the JSON in one code block" and how to use the error paths, then the whole of `plan-format.md`. The plan panel shows it read-only, with a copy button and the privacy text. Only the website version exists, so the text has the website clause: "Open Plan 不會上傳你的圖片或平面圖。此網站版把資料存在這個瀏覽器中。你把圖片交給 AI 助理時，圖片由該助理處理。" The local file mode text comes with C3, and the text beside image import with D1.
- **Tools:** a new user no longer gets the sample, so the visual capture, `bounds.mjs`, `replace.mjs` and `shadows.mjs` load the sample with 載入範例公寓 and reload with only that plan in storage (`tools/checks/sample-plan.mjs`). Against baseline 2, every pixel below the header is identical; the header differs only in the new 匯入 button. That change was accepted as **baseline 3** (`2026-10-07-chrome-155.0.8059.39-b3`); baseline 2 is kept.
- **Check:** `tools/checks/import.mjs`.
- **Added for the Step B review (2026-10-08):** a fast edit comes back with 復原上一個平面圖 after an import (one undo step); a failed backup stops an import (the plan, the undo history and the earlier backup do not change); and a real export from the original editor, `packages/core/test/fixtures/export-v1-9e1715d.json` (commit `9e1715d`, with a new name, an added bed, a demolished wall and a cost estimate; source and steps in `fixtures/README.md`), imports and also opens from saved v1 storage with no error or warning and with every edit kept. `packages/core/test/v1-export.test.ts` checks the same file with the migration and the strict validator.

### Draft import format (v2)

Units mm; x goes right and y goes down (the image direction). One continuous wall, 8 m long and 200 mm thick, with four openings. The room is below the wall on screen, which is the wall's right side.

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

- **Optional:** `measurements`, `dimensions`, `costEstimate`, opening heights (defaults in A2), opening `name`, door `entry`, room `at` (label position), room `counted: false` (not in the floor area).

### Draft agent prompt

> Convert the attached floor-plan image to Open Plan JSON, schemaVersion 2. Follow the schema exactly. Units are millimetres; x goes right and y goes down. Use one known dimension from the drawing to set the scale, and tell me which one you used. Give each wall as the centre line of the wall (`a` and `b`) and its `thickness`. Walls must be horizontal or vertical. Draw one continuous wall through doors and windows; do not split a wall at an opening. Give each door, window, sliding door and empty opening its `wallId`, its `offset` from the wall's `a` end and its `width`. For each door, give `hinge` (`start` or `end`) and `swing` (`left` or `right` of the direction from `a` to `b`, as seen on the image). Give each room a polygon on the inside face of its walls. Do not add furniture. If a part of the image is not clear, give your best guess and list it under "uncertain" in your reply, not in the JSON. If the plan has diagonal walls, say so and approximate them with horizontal and vertical walls.

### Step B done when

- **Safe replacement:** with an unsaved edit less than 400 ms old, Import, New empty plan and Load sample each keep that edit in the backup, and 復原上一個平面圖 restores it. With storage full, the replacement stops and the open plan does not change.
- **Round trip:** the JSON that the app exports imports again with no change.
- **Validation:** each rule has a node test with a bad file and the expected `code` and `path`. The schema and the validator agree on all structural fixtures.
- **v1 compatibility:** the current sample and an export from the current build load with no errors.
- **Migrate, save, reload:** a v1 plan with a tolerable issue (for example a self-crossing room) is migrated, saved as v2 and loaded again. It opens both times with the same warning. A v1 plan with an error that blocks rendering does not open, and its data is in the recovery copy.
- **Real image:** a plan that an agent made from a real floor-plan image imports and shows in 2D and 3D. Record the agent, the image and the errors found.

## Step C: agent access

**Goal:** a user's coding agent can make, check, draw and change a plan by itself, and the human sees the same plan live in the browser. No server and no account.

**Agents in scope:** agents with a shell and local MCP support, for example Claude Code, Codex, Gemini CLI, Cursor and OpenCode. Chat-only agents use the Step B import until Step E exists.

**Main idea:** in this mode, a **plan file on the user's computer is the source of truth**, not browser localStorage. Every layer below uses the one before it.

### C1. Core package

A framework-free TypeScript package (`packages/core`) with no React, no Three.js and no DOM. The browser app and all agent tools use it through its public exports (see Repository structure). It is created in A0, and Steps A and B fill it.

- Schema v2 types, the validator (B2) and the v1 → v2 migration (A1).
- Wall and opening geometry: line to rect, opening positions, content bounds.
- **Editing commands:** `add_wall`, `update_wall`, `delete_wall`, `add_opening`, `update_opening`, `delete_opening`, `add_room`, `update_room`, `delete_room`, `add_furniture`, `update_furniture`, `delete_furniture`, `set_ceiling_height`, `scale_plan` (D3 rules), `toggle_demolition`, `split_wall`, `join_walls`, `reverse_wall`, `move_wall_end`, `move_wall`, `move_opening`, `resize_opening`, `change_opening_type`.
- **Wall and opening rules** (all agents and the editor get the same behaviour):
    - **Delete wall:** deletes its openings. The result lists them.
    - **Move wall** (the whole wall): openings move with it; offsets do not change.
    - **Move a wall end (`move_wall_end`):** openings **keep their position in the plan**. Moving `a` changes every offset by the change in length at that end; moving `b` changes no offset. If an opening would go outside the wall, the command is refused. In this phase an end moves only along the wall line, so the wall stays axis-aligned.
    - **Split wall** at a point: each opening goes to the piece that contains it, with a new offset. A split point inside an opening is refused.
    - **Join walls:** only walls on the same line, with the same thickness and type, whose ends touch or overlap. Openings keep their position in the plan; offsets are calculated again. Different types or thicknesses are refused.
    - **Reverse wall** (swap `a` and `b`): `offset` becomes `length − offset − width`, `hinge` changes between `start` and `end`, and `swing` changes between `left` and `right`. Every door stays in the same place.
    - **Change thickness:** the centre line stays; door hinge points move with the faces.
    - **`update_wall`** accepts only `type`, `thickness` and `name`. Other fields are refused with a code that names the command to use (`move_wall_end`, `move_wall`, `toggle_demolition`).
    - **Type of a demolished wall:** it can change only to `n` or `low`. To change it to `b` or `e`, restore it first. A demolished bearing or exterior wall is not allowed.
    - **Join walls** with different demolition states: refused.
    - **`update_opening`** accepts only `name`, `entry`, heights (`sill`, `head`) and door `hinge` and `swing`. Other fields are refused with a code that names the command to use:
        - **`move_opening`:** changes `offset`, or moves the opening to another wall (`wallId` + `offset`). Refused if it does not fit or overlaps another opening.
        - **`resize_opening`:** changes `width`, from the start or the end, with the same checks.
        - **`change_opening_type`:** for example window → door. It must give all the fields of the new type; fields that the new type does not use are removed.
    - **Rooms** are not linked to walls in this phase. After a wall command, a room edge that was on a wall face and is no longer on it gives a warning.
- **Batches:** a list of commands is applied as one unit. The validator runs on the result. If it fails, nothing changes and the errors are returned with the index of the command that caused them.

**Decisions (C1 review, 2026-10-07):**

- **Validation of edits:** the result of a batch is validated with the **saved** policy: errors that block rendering refuse the batch, and tolerable issues are returned as warnings. Commands refuse their own forbidden outcomes regardless of the policy: an opening that overlaps another or goes outside its wall, the demolition of a bearing or exterior wall, and the other refusals listed above. `scale_plan` keeps the D3 rule: a result with errors is refused.
- **Batch contract:**
    - The input plan is never changed. A failure returns no plan.
    - `commandIndex` is zero-based.
    - A command refusal names the command that was refused. An error from the final validation names the first command after which the error exists.
    - Warnings that the plan had before the batch get no command index.
    - Success returns the normalized plan, its current warnings, and structured notes (for example the openings that `delete_wall` removed, and generated ids).
- **Ids:** `add_*` commands take an optional `id`. A missing id is generated from the working plan: deterministic and not used by any item in that list. Generated ids are in the notes. When a later command in the same batch refers to a new item, the agent gives the id itself.
- **Small additions:** an optional wall `name` (types, schema, validator and format description); `set_plan_name`; `set_material`, which creates or replaces one material by its key.
- **Shared document behaviour moves to core:** the v1 preparation (v1 check, legacy names, the guarded room corrections, which also appear in the migration report), sample and empty plan creation, and room geometry. The furniture library stays in the web app. Core does not depend on browser storage, React or Three.js. The sample data and its rendering do not change; generated plan ids may differ between creations.
- **Types:** rooms, materials and furniture get real types when commands need them, not `unknown[]`.
- **Two parts:** **C1a**: the move to core, the command and result types, batches, the wall and opening commands, `set_plan_name` and `set_material`. **C1b**: the remaining commands and the SVG drawing.

**Implementation (C1a):**

- **Moved to core:** `createSamplePlan`, `createSamplePlanV1`, `createEmptyPlan` and `SAMPLE_MATERIALS` (`sample.ts`); `checkDocumentV1`, `localizeLegacyNames`, `correctLegacyRooms` and `migrateV1Document`, the whole v1 path (`v1-document.ts`); `roomArea`, `roomPerimeter`, `containsPoint` (`rooms.ts`); `createId` and the deterministic `uniqueId` (`ids.ts`). The web files `seed.js`, `document.js`, `locale.js`, `geometryMigration.js`, `dimensions.js`, `roomGeometry.js` and `ids.js` are removed; the furniture library is now `furnitureLibrary.js`. The sample furniture colours that came from the library are fixed in core. A corrected old-sample room gives the report note `room-polygon-corrected`. Rooms, materials, furniture, measurements, dimension chains and the cost estimate have real types.
- **Same sample:** a test compares the core sample with the stored v1 fixture (only the fixed furniture ids differ), and the visual capture is pixel-identical to baseline 3.
- **Commands:** `applyCommands(plan, commands)` in `packages/core/src/commands/`, with typed `Command`, `CommandIssue`, `CommandNote` and `BatchResult`. A command is `{ "op": "move_wall_end", "wallId": "w1", "end": "a", "to": [x, y] }`. Every field is checked at run time: unknown fields are refused (`command-field-unknown`), and fields that another command changes are refused with that command (`field-not-updatable`, `params.use`). A refusal has the path inside the command, for example `commands[2].offset`.
- **Field choices** that the list above leaves open: `move_wall` takes `by: [dx, dy]`; `split_wall` takes `at: [x, y]` and an optional `newId` for the `b` piece; `join_walls` takes `wallId` and `otherId`, and the result keeps the id and direction of `wallId`; `resize_opening` takes `keep: "start" | "end"`, the edge that stays in place; `toggle_demolition` takes an optional `demolished`, and switches when it is left out.
- **Rules beyond the list:** a command refuses a window in a low wall, an opening in a demolished wall, and heights out of range on the opening it adds or changes. `move_wall_end` refuses a point off the wall line, and an end that passes the other end (use `reverse_wall`). Joining two walls that run in opposite directions changes the door hinge and swing of the joined openings, so every door stays in the same place.
- **Room edges:** after a wall command, each room edge is compared by length: the parts that were on a face of the changed wall, minus the parts on any wall face after the command. If some part lost its support (for example a wall that only got shorter), the warning `room-edge-off-wall` gives the command index and `uncoveredLength` in mm. A part that another wall still supports does not warn.
- **Field names** are checked as own properties, so `constructor`, `toString` or `__proto__` in a command are unknown fields.
- **Material `price`** (optional, 0 or more) is checked by the validator and the schema, the same as `set_material` checks it.
- **Check:** `packages/core/test/commands.test.ts` (each command, each refusal, the batch contract) and `shared-data.test.ts`.

**Implementation (C1b):**

- **Commands:** `add_room`, `update_room`, `delete_room`, `add_furniture`, `update_furniture`, `delete_furniture`, `set_ceiling_height` and `scale_plan`. All 25 commands of the list above (with `set_plan_name` and `set_material`) now exist.
- **Rooms:** a room command refuses what the validator only warns about on that room: a `mat` that is not in `materials` (`params.use`: `set_material`), fewer than 3 points, a crossing outline, an area below 0.01 m². The polygon checks are shared with the validator (`polygonArea`, `polygonSelfCrossing` in `rooms.ts`).
- **Furniture:** `rot` defaults to 0. `delete_furniture` also removes the item's price from `costEstimate.furniturePrices`, with the note `furniture-price-removed`.
- **`set_ceiling_height`:** 2000 to 6000 mm; refused if an opening head would be above the new ceiling (`opening-head-above-ceiling`).
- **`scale_plan`** takes `factor` and `pivot`, or `a`, `b` and the real `distance` (pivot `a`, as in D3). Only the D3 fields scale, rounded to 0.1 mm. Openings are placed from the scaled plan points of their two edges, so an opening that ended at its wall end or touched the next one still does. The result is validated: errors, and a plan larger than 100 × 100 m, refuse the command (`scale-result-invalid`, with the issues); other tolerable issues are warnings. The background image scales with the plan when D1 adds it.
- **Length tolerance:** 0.1 mm values are not exact in binary (1000.1 + 1000.2 is a little more than 2000.3). The validator and the commands compare lengths along a wall with a tolerance of 1e-6 mm (`LENGTH_TOLERANCE`), so rounding noise does not put an opening outside its wall or over the next one. A real 0.1 mm overlap is still an issue. Offsets that a command computes (reverse, move a wall end, split, join, resize from the end) are rounded to that 1e-6 mm grid (`cleanLength`), so noise never makes an offset negative, and reversing a wall twice gives back the exact values when they are on that grid (for example values in 0.1 mm). A value with more precision than 1e-6 mm comes back rounded to the grid. Offsets that a command or a file gives are not changed, so a negative offset is still refused.
- **2D SVG:** `renderPlanSvg(plan, { crop, width, grid, dimensions, labels, furniture })` in `svg.ts` draws rooms (material colour), walls by type (demolished walls dashed), windows, doors with leaf and arc, sliding doors, holes (the symbol direction comes from the wall, not from the opening rect, which is longer across the wall when the opening is narrower than the wall; the sliding panels stay inside the opening), furniture outlines, room names with areas, and optionally a 1 m grid (above the rooms, half transparent) and the dimension chains. Coordinates are plan millimetres; line widths and text follow the crop. The same plan and options give the same text.
- **Check:** `commands.test.ts`, `svg.test.ts` and the tolerance cases in `validate.test.ts`.
- **2D SVG drawing:** walls, openings, rooms, labels and furniture outlines. It is a simpler drawing than the editor; it is for checking, not for presentation.
- The editor's own edits move to these commands over time (README step 1). This is not required to finish Step C.

### C2. CLI

Package name **not decided** (see Decisions and open questions). Examples use the placeholders `<package>` for the npm package and `<cli>` for the command. Run with `npx <package>`. Output is text for agents and humans, or JSON with `--json`. Exit code 0 means success.

| Command | What it does |
| --- | --- |
| `<cli> schema` | Prints the JSON Schema and the short field description |
| `<cli> guide` | Prints the agent guide (C4) |
| `<cli> new plan.json [--sample] [--replace]` | Writes an empty plan, or the sample apartment. Refuses an existing file unless `--replace` is given; then it makes a backup first |
| `<cli> validate plan.json` | Prints errors and warnings with `path` and `code`; exit code 1 on errors |
| `<cli> migrate old.json plan.json` | Converts v1 to v2 and prints the migration report |
| `<cli> apply plan.json commands.json` | Applies a command batch; refuses if the file changed since `expectedRevision` |
| `<cli> render plan.json out.png [--crop x0,y0,x1,y1] [--width px] [--grid] [--dimensions] [--no-text]` | Draws the plan in 2D, optionally with a 1 m grid and dimensions, so an agent can compare it with the source image |
| `<cli> info plan.json` | Prints counts, plan size, rooms with areas, and the revision |
| `<cli> serve plan.json` | Live file mode (C3) |
| `<cli> backups plan.json` | Lists the backups of the plan |
| `<cli> restore plan.json <backup>` | Restores a backup through the lock, after a backup of the current file |

- **Revision:** a hash of the file content. `info` and `validate` print it; `apply` takes it.
- **Protocol writes** (CLI `apply` and `new`, MCP write tools, browser autosave through `serve`): each writer takes a lock file next to the plan (`<plan>.lock`). Under the lock it reads the file, checks the revision, writes a temporary file in the same folder and **renames** it over the plan (an atomic replacement). Writes through the protocol therefore never interleave, and no reader sees a half-written file.
- **Backups** in `<plan>.backups/<timestamp>-<revision>.json`:
    - **When:** before each CLI or MCP write, before each replacement (import into `serve`, "保留我的版本", migration, `new --replace`, `restore`, `scale_plan`), and once per browser session before the first autosave (see below). Not before every browser autosave.
    - **How:** under the **same lock** as the write. If the backup cannot be written, the write is **refused** and nothing changes. Old backups are pruned (keep the last 20) only **after** the write succeeds.
- **Direct file edits** (an agent that writes `plan.json` itself) are supported but do not use the lock. For them the guarantee is weaker: a conflict is **detected when it is observed**. A direct write that happens between a protocol writer's revision check and its rename can still be lost. The guide tells agents to prefer `apply`, or to stop `serve` before direct edits, and to run `validate` after each edit.
- **PNG:** from the SVG with a node image library, **2D only**. A 3D preview needs a headless browser, which is too heavy for this package. It is later work.

**Decisions (C2 review, 2026-10-07):**

- **Language:** TypeScript (`packages/cli`). **PNG:** `@resvg/resvg-js`, a CLI dependency.
- **Two parts:** **C2a**: the package, `schema`, `validate`, `info`, `migrate`, `new`, `apply`, `backups`, `restore`, with revision, lock, atomic write and backups. **C2b**: `render`, the CLI loop test and the packed install test. `guide` waits for C4, `serve` is C3, `mcp` is C5.
- **Revision:** the full SHA-256 (hex) of the file bytes as they are on disk.
- **Policies:** `validate` and `migrate` are strict (import policy); `apply` uses the saved policy with the command refusals (C1).
- **`apply`:** the commands file is `{ "expectedRevision": "...", "commands": [...] }`; a missing revision is refused. Read, revision check, backup and replacement happen under one lock.
- **Lock** (`<plan>.lock`): created exclusively, complete from the start, with a random ownership token, hostname, PID and creation time.
    - A live owner on this computer: wait up to 10 s, then `LOCK_TIMEOUT`.
    - An owner process that is confirmed not to exist: `LOCK_STALE`. An owner whose state is not certain (another hostname, no permission to check the process, an unreadable lock file): `LOCK_UNCERTAIN`.
    - Neither case removes or renames the lock. The message says to stop all writers first and then remove the lock file by hand. **Automatic stale-lock recovery is deferred:** a rename-based recovery is not exclusive, because another writer can take the lock path while the old lock is renamed away.
    - Release checks the token and never removes a lock with another token.
    - The guarantee is for **local file systems** only; exclusive creation is not reliable on some network file systems.
- **Paths:** an existing plan path is resolved with `realpath` (symlinks, letter case); a new file uses the canonical parent folder and its name. A plan file with more than one hard link is refused (two names would get two locks). The checks run under the lock.
- **Writes:** a temporary file in the same folder, synced to disk, then renamed over the plan. The backup is written and synced before the replacement; a failed backup refuses the write. Old backups are pruned to 20 only after the write; a pruning failure is reported as a successful write with a cleanup warning.
- **`migrate` and `new`:** an existing destination is refused unless `--replace` is given; replacing makes a backup first.
- **File format:** `JSON.stringify(plan, null, 2)` and a newline. This is not byte-identical to the web export, which has no final newline; a revision always reflects the bytes of the file.
- **Exit codes:** 0 success; 1 validation errors or a refused change; 2 usage error; 3 `REVISION_CONFLICT`; 4 lock error (`LOCK_TIMEOUT`, `LOCK_STALE`, `LOCK_UNCERTAIN`); 5 input or output error. Structured codes keep operational errors apart from validation errors.
- **Platforms:** macOS and Linux on local file systems first; **Windows is deferred.** Record what was actually tested.
- **`render` (C2b):** the stored reference PNG is geometry only, with all text off (a new SVG option `text: false` removes every text element and keeps the dimension lines), compared by decoded pixels. CJK labels are tested separately with a small committed subset of Noto Sans TC (OFL), with its licence and reproducible generation steps (source version and hash). Production rendering uses the system fonts.
- **Packed install (C2b):** core, the schema and the format description are bundled into the CLI with esbuild, so the installed CLI needs no workspace package or repository file; resvg stays an npm dependency.

**Implementation (C2a):**

- **Package:** `packages/cli` (private `open-plan-cli`, temporary command `open-plan` until the scope is chosen). `src/operations.ts` returns structured results that the MCP server (C5) can use too; `src/cli.ts` parses arguments with `node:util` and prints text or `--json`; `src/lock.ts` and `src/files.ts` hold the lock, the synced writes and the backups. The schema and `plan-format.md` are copied into `dist/assets` at build time, so the CLI does not read repository files at run time.
- **Commands:** `schema`, `validate`, `info`, `new`, `migrate`, `apply`, `backups`, `restore`, as in the table above. `validate` on a v1 file checks it through the migration and says to run `migrate`. `info` works on a plan with tolerable issues and lists them as warnings. `apply` on a v1 file is refused (`NOT_VERSION_2`). `restore` takes only a name from `backups`, writes the backup bytes unchanged, and refuses a backup that is not a readable plan: a v1 backup must pass the complete migration and the saved-policy v2 validation, not only the preliminary document check. `migrate` with the same file as source and destination (also through a symlink) reads and converts the file under the plan lock. `apply` compares the normalized starting plan with the result: a batch that changes nothing keeps the bytes and revision of the file in any format (minified, web export) and makes no backup.
- **Lock race found by the 100-writer test:** a writer could read a lock, the owner then released it and exited, and the writer then saw a dead process and reported `LOCK_STALE` for a lock that was released correctly (13 of 100 writers). A dead process cannot release a lock later, so after a dead owner is seen the lock file is read again: `LOCK_STALE` only if the same token is still there; otherwise the writer tries again.
- **Lock wait cost found by the same test:** each retry wrote and synced a new temporary lock file, so 100 waiters slowed the owner and the last writer finished after about 9.7 s, near the 10 s `LOCK_TIMEOUT` (2 of 100 timed out in one full run). Each writer now writes and syncs its lock content once, and a retry is one `link`. The last of 100 writers now finishes after about 1 to 1.5 s.
- **Tested:** macOS 26 (APFS, local disk) with Node 24 only. **Linux is not tested yet.** Windows is deferred.
- **Check:** `packages/cli/test` (Vitest, which builds core and the CLI first and runs the built CLI): every command and exit code; revision, backup bytes and pruning to 20; a failed backup and a failed pruning; in-place migration while another writer changes the file (direct and through a symlink); v1 backups that pass the preliminary check but not the migration; a batch that changes nothing on minified and web-export files; symlink aliases on one lock; hard-link refusal; `LOCK_STALE` and `LOCK_UNCERTAIN` that leave the lock unchanged; release that keeps another writer's lock; 100 parallel `apply` calls with one starting revision (exactly one success, 99 `REVISION_CONFLICT`, one backup, no temporary or lock file left).

**Implementation (C2b):**

- **`render`:** reads the plan with the saved policy (tolerable issues are warnings; errors that block rendering refuse with `VALIDATION_FAILED`, and nothing is written), draws it with `renderPlanSvg`, converts it with resvg, and replaces the PNG atomically. It takes no lock and changes no plan or backup. A width from 1 to 8000 px (default 1200), a crop with x0 < x1 and y0 < y1, and an output that is not the plan file itself; other values are usage errors (exit 2). The height follows the crop, so the derived size is checked before drawing (core `planImageSize`): at most 8000 px on each side and 32 million px, else exit 2. `--no-text` loads no system fonts, so it is also faster (system font loading takes about 0.6 to 2 s on this Mac).
- **Core:** `renderPlanSvg(plan, { text: false })` removes every text element and keeps everything else, including the dimension lines.
- **Build:** `scripts/build.mjs` bundles the CLI with esbuild into one file, `dist/cli.js`, with core and the schema and format description (as text). Core comes in through its public package exports (its compiled `dist`), so the CLI build builds core first. `open-plan-core` is a dev dependency only; the one runtime dependency is `@resvg/resvg-js`. The bundle holds no local path.
- **References:** `packages/cli/test/references/loop.png` (geometry only) and `sample-cjk.png` (the sample with labels and dimensions, drawn with the test font only). They are compared **exactly**: the same size and the same decoded RGBA bytes in every pixel, with no tolerance for anti-aliasing. A test shows that one channel of one pixel 1 step off is found. A different resvg build or platform may not give the same bytes; if Linux or x64 differs, a tolerant compare needs its own decision. `UPDATE_REFERENCES=1` writes them; a failed compare writes the image and a diff next to the reference.
- **Test font:** `packages/cli/test/fonts/OpenPlanTestTC.ttf`, 13 KB: Noto Sans TC from `google/fonts` at a pinned commit, regular weight, only the characters of the sample SVG text, renamed "Open Plan Test TC". `OFL.txt`, the source hash, the fonttools version and the steps are in `fonts/README.md`; the script refuses another source and gives the same bytes each time. The first subset showed a box for the space before "m²" (the character list lost its leading space), which is the kind of error this test is for.
- **Check:** `packages/cli/test/render.test.ts`: the CLI loop (a scripted agent writes a plan with 3 errors, reads `validate --json`, corrects them at their paths, and `render` matches `loop.png`); the compare finds a wall 20 mm off and a missing door; `text: false` draws no text even when a font is available; the CJK reference, with a check that the font has every character of the sample text; crop, width, warnings, a refused plan, and the usage errors. `pnpm --filter open-plan-cli test:pack` packs the CLI, installs it with npm in a new folder outside the repository, and runs `schema`, `new`, `validate`, `apply`, `info`, `render` (the same PNG bytes as the workspace build) and `restore`. It needs the npm registry, so it is not part of `pnpm test`.
- **Tested:** macOS 26 (arm64) with Node 24.21 and npm 11.19 only. Linux is not tested yet.

### C3. Live file mode (`<cli> serve`)

- Serves the built editor and the plan file on `http://127.0.0.1:<port>`, and opens the browser.
- **File to browser:** when the file changes on disk (agent edit), the editor loads the new version if it has no unsaved edit and no gesture in progress. Otherwise it shows "檔案已在外部變更" with "載入檔案版本" and "保留我的版本".
- **Invalid or half-written external file:** if the new file content does not parse, or has an error that blocks rendering, the browser **keeps its last valid plan**, shows the error, and stops autosave to the file. When the file becomes valid again, it is treated as **any other external change**: it loads only if the browser has no unsaved edit and no gesture in progress; otherwise the conflict message is shown.
- **"保留我的版本":** writes the browser plan with the **last file revision that the user saw** in the message, after a backup of that external version. If the file changed again after the message, the write is refused and a new message is shown.
- **Browser to file:** autosave writes to the file, not to localStorage, with the revision it started from. If the file changed in between, the write is refused and the same message is shown. A protocol write never writes over a change that it has observed; see the limit for direct file edits above.
- The undo history is reset when an external version is loaded, the same as Mamezu's remote snapshot rule.
- **Security:**
    - Listen only on `127.0.0.1`, never on `0.0.0.0`. LAN access needs an explicit `--host` option with a warning.
    - Each start makes a random token. The browser URL contains it, and every read and write request must send it. This blocks other websites from reading or writing the plan through the local port.
    - Reject requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`, to block DNS rebinding.
    - The server reads and writes **only the one plan file** given at start, and its image (D1). No other path is reachable.
- **Two separate storage modes:** the website (browser storage) and local file mode (`serve`). They do not synchronize. The user moves a plan between them with export and import. This avoids automatic synchronization conflicts. Each mode keeps its own backup and recovery:
    - **Website:** B1 (replacement backup), H2 (unreadable data), and a **session snapshot**: before the first autosave of each session, the saved plan is copied to a recovery key. Undo is lost on restart; this snapshot is not.
    - **File mode:** the lock, the atomic write, the last-valid-plan rule, and the backup folder, with one backup per browser session before the first autosave.
- **Mode indicator:** the editor always shows the active mode and location, for example "網站模式 · 儲存在此瀏覽器" or "本機檔案模式 · ~/plans/home.json".

**Decisions (C3 review, 2026-10-08):**

- **Three parts, each with a review stop:** **C3a** the server (API, security, file watching, start-up rules), tested with HTTP requests; **C3b** the editor's file mode (synchronized autosave, external changes, conflicts, invalid file, replacements, mode indicator), tested in the browser against a real `serve`; **C3c** the website session snapshot, the privacy text, the bundled editor and the packed install test with `serve`.
- **Start-up:** `serve <plan.json> [--port n] [--host address] [--no-open]`. It refuses a missing file (use `new`), a v1 file (use `migrate`; otherwise the first autosave would convert it silently) and a file with errors that block rendering (use `validate`), with exit code 1. Tolerable issues open with warnings.
- **Port:** a fixed default port; only the default falls back to the next free port. An explicit `--port` that is in use fails. Each port is a separate browser origin, so a random port would lose the browser preferences at each start.
- **Security:**
    - The token is 32 random bytes from the system's cryptographic source. It is in the URL fragment (`#token=`), which the browser never sends to a server; the API reads it from the `X-Open-Plan-Token` header and compares it in constant time.
    - `Host` must be exactly `127.0.0.1:<port>` or `localhost:<port>`, with the actual port; `--host <address>` adds exactly `<address>:<port>` and prints a warning that the connection is plain HTTP. A request with an `Origin` header must have `http://` and an allowed host; a request without `Origin` (a non-browser client) is accepted with a valid token. No CORS headers are sent, so a browser on another site cannot pass the preflight that the custom header causes.
    - Request bodies are limited (20 MB, as for import). Routes are fixed; no request names a file system path. The editor's static files are a fixed list from the bundled folder; they hold no plan data and need no token, but the `Host` check applies to them too.
- **Writes from the browser** use the C2 lock, revision check, saved-policy validation, atomic write and file format. A plan with errors that block rendering is refused. A plan that is the same as the file's normalized plan is not written (the bytes and the revision stay).
- **Autosave acknowledgement:** one write in flight per browser. A successful response marks the **submitted snapshot** as synchronized, not the plan that is open when the response comes; edits made during the request stay unsaved and are saved next. Loading an external version, which the validator normalizes, makes **no write**.
- **Backups:** one backup of the file before the first write of each browser **session** (one page load); if it fails, that first write is refused. The same rule applies to the website session snapshot (C3c): if it fails, the first autosave is refused. Backups of browser plans have a label in the name (`-browser` for the plan kept before 載入檔案版本, `-replaced` for the plan before a replacement), so they are not mistaken for earlier file contents; `backups` shows the label.
- **載入檔案版本** is one guarded request: the browser sends the revision shown in the conflict message and its plan. Under the lock the server checks that revision, backs up the browser plan (`-browser`), and returns that file version. If the revision changed or the backup fails, the browser keeps its plan and the conflict message is refreshed.
- **保留我的版本** is a write with the revision shown in the message and `mode: "keep-mine"`: the file's current bytes are always backed up first, under the same lock, also when the session has written before (an autosave backs up only before the session's first write).
- **Replacements in file mode** (Import, New empty plan, Load sample): the browser plan is backed up on the server with the `-replaced` label first (a failure stops the replacement); the new plan is then one undo step in the browser and is written by autosave with the revision check. **復原上一個平面圖** reads the newest `-replaced` backup from the server and loads it into the browser as one undo step; autosave then writes it with the revision check. It never replaces the file directly, so C2 `restore` is not used for it.
- **Change events:** the server watches the folder (`fs.watch`, because an atomic rename replaces the file) and also checks the file once per second as a fallback. The 1 s check is a fallback target, not a guaranteed end-to-end deadline. Every change, also the server's own writes, goes to every connected browser with the new revision; a write made for a browser request carries that request's id, so only the browser that sent it treats it as its acknowledgement, and other tabs load it as an external change. Events go over a `fetch` stream (so the token can be a header). After a reconnect, the browser reads the current state first; a missed event cannot leave it on an old plan.
- **Failure states:** an invalid file, a disconnect or a lock error keeps the browser's edits and blocks writes. A retry reads the current revision before it saves. When the server stops, writes in progress finish first; the browser shows the disconnect, keeps the plan and offers a download, and warns before the page is closed with unsaved edits.
- **Direct file edits** keep the weaker guarantee stated in C2: a conflict is detected when it is observed, and a direct write between a protocol writer's revision check and its rename can be lost.
- **Tests:** C3a: concurrent tabs (sessions), stale conflict actions, missed events and reconnects, backup failures, invalid-file recovery, and every security refusal. C3b also: edits made while a save is in flight, and external loads that cause no write.

**Implementation (C3a):**

- **Files:** `packages/cli/src/file-mode.ts` (the file-mode operations, apart from HTTP: read the state, write a browser plan, keep a labelled browser backup, load the file version, read a backup) and `src/serve.ts` (the HTTP server). `serve` in `src/cli.ts` runs until Ctrl+C or SIGTERM. The CLI build now also builds the web app and copies `apps/web/dist` to `dist/editor`; the packed install test checks that it is in the package. The editor itself is not changed yet (C3b).
- **Default port:** 5190, then up to 5209.
- **Routes** (all with the token): `GET /api/plan` (the state: revision, valid, normalized plan, warnings, errors); `PUT /api/plan` (`expectedRevision`, `plan`, `sessionId`, `requestId`, and `mode`: `autosave` or `keep-mine`); `POST /api/load-file` (`seenRevision`, `plan`); `POST /api/browser-backups` (`plan`, `label: "replaced"`); `GET /api/backups`; `GET /api/backups/<name>`; `GET /api/events` (event stream). Status codes: 401 token, 403 Host or Origin, 404, 405, 409 `REVISION_CONFLICT`, `FILE_INVALID` or `PLAN_PATH_CHANGED`, 413, 415, 422, 423 lock errors, 503 stopping, 507 `BACKUP_FAILED`.
- **Events:** the first event is `state` (the current state); each later change is `change` with the state and a `requestId`. The server records the revision of a browser write under the lock, just before the rename; any check that finds that revision sends it with the write's request id. The first version sent it from the write handler, and a test found that the folder watcher could send the same change first without the id, so the tab that wrote it would have taken its own write for an external change.
- **Plan path:** every operation uses the canonical path found at start. If the name given at start later resolves to another file (a symlink pointed elsewhere), every API request is refused with `PLAN_PATH_CHANGED`; serve must be started again.
- **New streams:** the first state of a new event stream is read and the stream is registered in the same serialized step as the change checks, so no change can be sent between the read and the registration.
- **Found in review and fixed (2026-10-08):** 保留我的版本 had no backup after the session's first write, so the external version was lost; after a symlink given at start was pointed at another plan, writes went to that plan while reads stayed on the first; a change during a new stream's first read could be missed for good. Each has a test that failed before the fix (the stream test pauses the first read with a test hook).
- **Found by the tests and fixed:** a stop waited for the file write but not for its response, so Ctrl+C could cut the response; leaving a `for await` loop over a request body destroys the request, so a body over the limit without `Content-Length` gave a connection reset instead of 413 (the body is now read with `data` events and the rest is dropped).
- **Not tested here:** the editor (C3b); Linux; a real LAN address for `--host` (the test uses the IPv6 loopback `::1`).
- **Check:** `packages/cli/test/serve.test.ts` (26 tests): the start-up refusals and the port rules; session backups (one per session, again for another session, also after a first write that was refused); the unchanged-plan rule on a minified file; stale revisions, blocking errors and two tabs writing at once; a failed session backup; events to every tab with the writer's request id and no duplicate from the watcher; a CLI apply, a direct write and a rename over the plan; a reconnect after a missed change; an invalid file and its recovery; 載入檔案版本 with the right revision, an old one, an invalid file and a failed backup; `-replaced` backups and refused backup names; the token, Host, Origin, CORS, body and route refusals; `--host`; a stop during a write; 保留我的版本 after an earlier write; a retargeted symlink; and a change during a new stream's first read. 13 mutations of the protections were tried: 11 make a test fail; the two others only remove a second layer (the `Content-Length` precheck, and dropping chunks after the limit) and change no result.

**Implementation (C3b):**

- **Start:** `main.jsx` looks for `#token=` in the URL. With it, `openFileSession` reads the file state (and whether a `-replaced` backup exists) before the editor starts; a failure shows a page that says to open the link that serve printed. Without it, the editor starts in website mode exactly as before; the website code paths do not change, and the six website checks and the visual capture (identical to baseline 3) confirm it.
- **`apps/web/src/floorplan/fileSession.js`:** the protocol and the synchronization state, apart from React. The editor gives it `latest`, `busy` (a 2D or 3D drag, a pan, a measurement, or a focused field), `settle` and `load` (a file version without an undo step; the undo history starts again, and the view does not fit again). States: `ok`, `saving`, `conflict`, `invalid`, `disconnected`, `error`; the last four block writes and show a notice that cannot be dismissed (`data-file-notice`), with 載入檔案版本 and 保留我的版本, or 重試, and 下載目前平面圖.
- **Autosave** keeps the 400 ms delay and calls the file session, which writes only when the open plan differs from the synchronized one. A conflict that arrives during a write stays shown when the write ends.
- **Replacements** keep the browser plan on the server (`-replaced`) and then follow B1; 復原上一個平面圖 reads the newest `-replaced` backup. The page asks before it is closed while an edit is not in the file.
- **Mode indicator:** only in file mode for now (`本機檔案模式 · <path>` in the status bar, with the home folder as `~`; `GET /api/plan` now also returns the path), and the save button says 儲存. The website indicator ("網站模式 · 儲存在此瀏覽器") changes the website header, so it moves to C3c, together with the session snapshot and a new visual baseline.
- **Response order (review fixes):** each change of the file-session view has a version; a response changes the view only if nothing newer (an event, a lost connection) changed it during the request. This applies to every result of save, 保留我的版本, 載入檔案版本 and 重試: success, 409, other errors and network failures. A late successful write still counts as written, but a newer conflict, invalid file or lost connection stays shown. A page that started on an invalid file keeps a snapshot of its fallback plan: if it was edited, the repaired file is a conflict, not a silent load. 載入檔案版本 loads only if the open plan still equals the plan sent (and backed up); an edit made during the request gives a conflict with a message instead. Replacement and 復原上一個平面圖 stop with a message if the plan changed while the server backup was written or read. `apps/web/test/fileSession.test.js` (21 tests) decides the order of the server responses, including a delayed 409, server error and network failure after a newer invalid or conflict state; twelve mutations of these guards each make it fail.
- **Test build:** Vitest sets `NODE_ENV=test`, so the CLI build in its global setup made a React development build of the editor in `apps/web/dist` and `dist/editor`. The setup now builds with `NODE_ENV=production`. The development build failed one import check (focus back to 匯入 after Escape, also at C3a), because StrictMode runs effects twice; production is not affected.
- **Check:** `tools/checks/serve.mjs` (41 checks) starts the built CLI's `serve` and covers: the indicator, and no website storage in file mode; browser edits in the file, with the session backup only before the first write; agent changes (CLI apply, and a direct minified file without heights) loading at once with **no write**; the undo reset; conflicts during a drag and during typing, resolved both ways, with the backups; a stale conflict action (refused, and the message refreshed); edits made while a write waits for the lock (one request at a time, and the later edit written next); a lock error with 重試; an invalid file (the plan kept, no write, and the conflict when the file is valid again); a dropped connection through a proxy (the change made meanwhile loads after the reconnect, or is a conflict with an unsaved edit); replacement and restore, and an edit made while their server request is pending (held with `page.route`), which stops them; the question on page close; and website mode on the same address. Nine mutations of the synchronization rules each make it fail. `context.setOffline` was tried first for the dropped connection; it does not close an open connection to 127.0.0.1, so the test would have passed without a reconnect.

**Implementation (C3c):**

- **Session snapshot (website):** `saveDocument` in `storage.js` keeps the saved plan in `open-plan:document:v1:session` before the **first write of a page load that changes the saved plan**, not at load. Autosave also runs at load, so a copy at load would let a reload after a mistake replace the good copy with the mistake; with this rule a reload without a change keeps it. A change is a plan that differs from the plan **as the editor opened it** (after migration and normalization), not from the saved bytes: a saved plan without its optional default heights, or with other formatting, is not written at load, so its bytes and the copy stay (found in the C3c review). A saved v1 plan is still saved as v2 at load (B2), without a copy; the v1 bytes stay in `before-v2`. If the copy fails, that write is refused and the status says so (儲存失敗：無法先備份已儲存的平面圖…). With nothing saved, an older copy (from another plan) is removed. The plan panel has 復原開始編輯前的平面圖 (website mode only); it is a B1 replacement, so the open plan is backed up first and 復原上一個平面圖 brings it back.
- **Mode indicator:** the status bar always shows the mode: "網站模式 · 儲存在此瀏覽器" or "本機檔案模式 · <path>" (`data-storage-mode`). **Baseline 4** (`2026-10-08-chrome-155.0.8059.39-c3c`, approved in the C3c review) differs from baseline 3 only in the status bar.
- **Mode-aware text:** the privacy text beside the agent prompt and the storage help in the plan panel have a website and a local file version; the panel's save button uses the mode's label. The text beside image import comes with D1.
- **Packed install:** the packed install test also starts the installed `serve`: the bundled editor page and its script, `GET /api/plan` with the token (plan and revision), a refusal without it, and a clean stop on SIGTERM.
- **Check:** `tools/checks/session.mjs` (19 checks): the indicator and the website texts; no copy without a change, also for omitted heights, other formatting and a v1 plan; the copy at the first change, kept through later changes and a reload; the restore as a replacement; a failed copy that refuses the write; an older copy removed when nothing is saved. Six mutations of the snapshot rules each make it fail. `serve.mjs` (43 checks) now also checks the file-mode texts, no snapshot button in file mode, and the website indicator on the same address.

### C4. Agent guide

One source text, published in several forms. It contains: what Open Plan is, the schema summary, the coordinate and direction rules (A1), the image-to-plan steps, the CLI commands, and the work loop:

1. Write or change the plan.
2. Run `validate` and correct every error.
3. Run `render` and compare the PNG with the source image; correct differences.
4. Report the scale you used and the uncertain parts to the human.

Forms:
- `<cli> guide` output, and the MCP server `instructions` and a guide resource (C5).
- An `AGENTS.md` section that users can copy into their project. Codex, Cursor and OpenCode read `AGENTS.md`; Gemini CLI can be set to read it (it reads `GEMINI.md` by default).
- A **Claude Code skill**.
- `llms.txt` on the website.
- A test makes sure that all forms come from the same source and are up to date.

**Decisions (C4 review, 2026-10-08):**

- **Two parts, each with a review stop:** **C4a** the guide, its forms and their tests (no agent needed); **C4b** the real-agent exercise.
- **Command reference:** there are **25 commands**; `scale_plan` has two argument forms (`factor` and `pivot`, or `a`, `b` and `distance`), and both are documented. Each command has a complete contract: required and optional fields, defaults, units, effects on related items (openings in a wall, room edges, prices), and the important refusals. The reference also explains the batch envelope (`expectedRevision` and `commands`), that the revision is the SHA-256 of the raw file bytes, that a batch is atomic, warnings, generated-id notes, and how to retry after `REVISION_CONFLICT`. Coverage is tested by unique `op` and by each argument variant; a name in the guide is not coverage.
- **Self-contained:** the coordinate rules and the image instructions are shared source fragments (the website prompt uses the same fragment); the generated forms embed `plan-format.md` and the command reference. No form needs a repository-relative link.
- **Examples, not repository instructions:** the copyable `AGENTS.md` section and the Claude Code skill are in a documented examples folder. The project's own root `AGENTS.md` (if one is added) is not generated user documentation.
- **Test the shipped interface:** command examples run through the built CLI with real revisions; the packed package's `guide` works outside the repository; the committed copies are compared with the generated text (a check: tests never write them).
- **`<cli>`:** one placeholder constant, explained once in the guide; the C4b exercise uses the concrete local command.
- **Language:** English for agent documentation; the UI stays zh-TW.
- **C4b:** a fresh agent session with only the guide, the image and the installed CLI, kept apart from repository instructions; no human needs to run it. Record the agent and its version, the inputs, the corrections and the output. It closes the Step B image item **only after the JSON is imported and checked in 2D and 3D**; passing `validate` alone does not. It does not replace the C5 MCP compatibility tests.

**Implementation (C4a):**

- **Source:** `docs/agent-guide/` (`intro.md` with the work loop and the `<cli>` note, `image-to-plan.md`, `cli.md`, `commands.md`) and `docs/plan-format.md`. `packages/cli/src/guide.ts` assembles them (`CLI_PLACEHOLDER = '<cli>'`); the format's link to the schema file becomes "printed by `<cli> schema`", so no form has a repository link.
- **CLI:** `guide [--form text|agents-md|skill|llms] [--cli <command>]`. `--cli` puts one command in place of `<cli>` (for C4b), and the note about the placeholder then names that command.
- **Copies:** `examples/agents/AGENTS.md`, `examples/agents/claude-code/skills/open-plan/SKILL.md` and `apps/web/public/llms.txt` (served at `/llms.txt`), with `examples/agents/README.md`. `pnpm --filter open-plan-cli guide:write` writes them with the built CLI; tests only compare.
- **Website prompt:** `agentPrompt.js` now uses `image-to-plan.md`, with a chat opening and closing. The wording changed a little (the rules are a list; "report the scale and the uncertain parts in your reply, not in the JSON"). Its format part still has the schema link, which a chat agent cannot follow; it does no harm.
- **Command reference:** all 25 commands, with fields, defaults, effects, refusals and one or more example batches; `scale_plan` both forms, and how the form is chosen (a command with `pivot` but no `factor` is read in the distance form and refused with `command-field-unknown` for `pivot`, found by the tests).
- **Opening rules per command (found in the C4a review):** the reference first said that every opening command checks the placement rules. `delete_opening` checks nothing more, and `update_opening` checks only heights and `field-not-for-type`; `move_opening` checks the wall it moves to. So an opening in a demolished wall (`toggle_demolition` keeps it) can be updated, deleted or moved to another wall, but not moved in its wall, resized or given another type. The reference now says this, and a test checks it.
- **Checks:** `packages/cli/test/guide.test.ts` (64 tests): one section per `op`; **each argument form** (each opening type, each `scale_plan` form) documents exactly the fields that the core code accepts in that form (from its `command-field-unknown` refusal); in each form, a command with **every documented field** passes the field checks, each required field left out gives `missing-field`, and each optional one does not (so fields that no example uses are tested too); the fields that select a form are documented as required, a missing opening `type` gives `missing-field`, and a `scale_plan` without `factor` but with `pivot` gives the documented `command-field-unknown`; the rules for an opening in a demolished wall; every refusal, note and warning code of the command code is named; every example batch and the envelope example run through the built CLI with a real revision, write a new revision and leave a plan that passes `validate`; the refused example gives exactly the documented output; every form is self-contained; the committed copies equal the CLI output. `apps/web/test/agent-prompt.test.js`: the website prompt has the shared fragment and the format. The packed install test runs the installed `guide`. Eighteen mutations each make the tests fail: a missing section, an unnamed code, required and optional swapped both ways, an undocumented field, a changed refusal output, a refused example, a new field in the core code, a field documented for the wrong opening type (two cases) or the wrong `scale_plan` form, a wrong required mark on three fields that no example uses, `type` (two commands) or `factor` documented as optional, and the removed sentence about how the `scale_plan` form is chosen.

**C4b (2026-10-08):** Claude Code 2.1.285 (`claude-opus-5-5`) and Codex 0.160.0 (`gpt-6.1-sol`) each made a plan from one real floor-plan image, using the supplied guide, the image and the installed CLI, in separate clean folders. (Corrected after C5c preparation: Claude Code likely loaded the user's global `CLAUDE.md`, and the Codex config enabled a plugin and the `apps` feature, so the runs were not fully isolated; the record has the details.) Both plans pass `validate`, import in the website and draw in 2D and 3D, so the CLI workflow is accepted. In this exercise Claude Code's result was better (window widths within 1 % of the labels); Codex's plan makes a separate room of part of the open living area (with two openings that the image does not show in the wall behind the sofa), draws the balcony edges as exterior walls instead of low walls, and uses default window heights. The models and reasoning settings differed, so this is not a general ranking. Record: [`docs/agent-exercises/2026-10-08-c4b-real-image.md`](agent-exercises/2026-10-08-c4b-real-image.md). The image is MIT-licensed (confirmed by the user). The user closed the Step B image item on 2026-10-08 without a separate visual review. C5 (MCP) is not covered.

**C4 follow-up (2026-10-08):** the guide fixes from the C4b findings, before the guide is used for C5. (1) `render --crop` takes negative values with or without `=` (the CLI joins a value that starts with `-` to `--crop`; test in `render.test.ts`), and the command table says that the values can be negative. (2) "From an image to a plan" (also in the website prompt) tells the agent to use the sill and head heights that the drawing gives, and to report the heights that it could not read. (3) It also tells walls and partitions (`e`, `b`, `n`), low walls such as balcony parapets (`low`) and cabinets apart by hatching, line weight and height labels; cabinets are left out and uncertain boundaries are reported. The guide copies were written again with `guide:write`. The C4b plans were not made again with the new guide; C5 uses it.

### C5. Local MCP server (stdio)

`npx <package> mcp`, started by the agent. Setup is one line or one config entry per agent, for example `claude mcp add open-plan -- npx <package> mcp`. The guide gives the setup for each agent in scope.

| Tool | Read-only | Notes |
| --- | --- | --- |
| `get_guide` | yes | The full guide in the MCP form |
| `get_schema` | yes | Schema and field description |
| `read_plan` | yes | Plan JSON and revision |
| `plan_info` | yes | Counts, size, rooms with areas |
| `validate_plan` | yes | A path or inline JSON (exactly one); returns errors and warnings |
| `render_preview` | yes | Returns a PNG image, optional crop and grid; size limits |
| `create_plan` | no | Empty or sample; refuses to write over an existing file |
| `write_plan` | no, destructive | A whole plan; exclusive creation, or replacement with `expectedRevision` |
| `apply_commands` | no | Needs `expectedRevision`; returns the new revision or `REVISION_CONFLICT` |
| `migrate_plan` | no, destructive | v1 to v2 with report; replacement with `expectedRevision` |

- Tools work on plan files **inside the agent's working directory only**. Paths outside it are refused.
- The server sends the agent guide as `instructions` at start, and offers it as a resource and as a prompt (`convert_floor_plan_image`).
- Tool annotations mark read-only and destructive tools, so agents can ask the user before a write.
- When `serve` runs for the same file, the browser shows MCP changes live through C3. No extra link is needed.

**Decisions (C5 review, 2026-10-08):**

- **Three parts, each with a review stop:** **C5a** the server, its tools and their automated tests (no real agent); **C5b** the acceptance tests for MCP (100 parallel writers from the CLI and MCP, backups, live update in `serve`); **C5c** real agents (Claude Code and Codex from a real image to a plan shown in `serve`; Gemini CLI, Cursor and OpenCode: connection and `validate_plan`). C5c records the working directory that each client gives to the server.
- **Library:** the official `@modelcontextprotocol/sdk`, pinned to an exact version. Checked on npm on 2026-10-08: 1.32.1, Node 18 or later, peer dependency `zod` 3.25 or 4. Its package also has HTTP transports (express, hono and others); only the server and the stdio transport are imported, and esbuild bundles them, so the installed package gets no new runtime dependency. C5a checks that the bundle works alone (from the packed install, with no unresolved runtime dependency), that it does not start an HTTP transport, its size, and the license notices.
- **stdout is only for MCP messages.** Diagnostics go to stderr. The operations return their notices and print nothing.
- **One code path per operation:** `apply(file, commandsFile)` becomes `applyBatch(file, { expectedRevision, commands })` (the CLI reads the commands file and calls it); `render(file, out)` becomes `renderPng(file, options)`, which returns the PNG (the CLI writes the file). MCP and the CLI use the same lock, validation, revision check and backup code. Tool annotations are only hints: each handler enforces its rules.

**Workspace boundary (C5 only; the CLI still accepts any path):**

- **Root:** the canonical (`realpath`) working directory of the server at start, or `mcp --root <dir>`. Setup examples give an absolute `--root`. A relative tool path is resolved against the root, not against the process directory; an absolute path is accepted only inside the root.
- **Check:** the canonical path of an existing file, or the canonical parent folder and the name of a new file, must be inside the root. The refusal is `PATH_OUTSIDE_WORKSPACE`. A symlink (file or folder) that resolves outside the root is refused; one that resolves inside is used through its target.
- **I/O uses the checked path:** after the check, every read and write uses the canonical path, never the name that was given. Writes check containment again **inside** the locked operation, with the path identity check that `lockedPlan` already does. The lock file, the temporary file and the backup folder are next to the canonical plan path, so they are inside the root; the lock and temporary files are created exclusively (an existing name or symlink there is refused), and the backup folder must be a real folder inside the root (a symlinked backup folder is refused).
- **Tests:** `../` paths, absolute paths, a symlinked file and a symlinked folder pointing out, a migrate destination outside, a hard link, a symlinked backup folder, and a **symlink retargeted between the check and the I/O** (through a test hook in the operation), for a read and for a write.
- **Remaining limit (to state in the guide and the record):** Node has no API to open a path relative to a held folder handle with no symlink followed at each step. A process that renames or replaces a folder in the path at the same moment as a call can still direct one read or write outside the root. The boundary protects against mistakes and existing links, not against a hostile local process that runs at the same time.

**Tools and their contracts:**

- **Common:** each tool takes `path` (relative to the root) where it works on a file. The result is `structuredContent` plus the same JSON as text (and the image for `render_preview`). A refusal has `isError: true` and `{ ok: false, code, message, errors? }`, with the same codes as the CLI. Bad arguments give `USAGE`.
- **Shared fields and transport fields:** where a tool has a CLI equivalent, the **shared fields** are equal to the CLI's `--json` result and a test checks them: `ok`, `code`, validation issues (`errors`, `warnings`), `revision`, `previousRevision`, `currentRevision`, command `warnings` and `notes`, `backup`, `migrationReport`. **Transport fields** are documented per tool and are not compared: the CLI's `output` path versus the MCP image content in `render_preview`; no `revision` for an inline plan in `validate_plan`; `write_plan`, `read_plan` and `get_guide` have no CLI equivalent and have their own documented fields.
- **Input limits (MCP only):** a plan file is at most **5,242,880 bytes** (5 MiB) of file bytes, checked during a bounded read (at most that many bytes plus one are read, whatever the file size says); an inline plan is at most 5,242,880 bytes as UTF-8 JSON; `commands` is at most **1000 commands** and at most **1,048,576 bytes** (1 MiB) as UTF-8 JSON. **Every file read is bounded**, also the read of the current file under the lock (the file can grow between a first read and the lock). Larger input is refused with `INPUT_TOO_LARGE` (with the limit and, when known, the size); inline input is refused before the lock. An oversized file can be found after the lock is taken, but it never causes a backup or a plan write.
- **`get_guide`** (read-only, new): returns the full guide in the MCP form. Resources and prompts depend on the client, so a tool also gives the guide.
- **`get_schema`** (read-only): the JSON Schema and the field description.
- **`read_plan`** (read-only): the file's JSON **as it is in the file** (not normalized), its `schemaVersion`, and the `revision` of **the bytes that were read**, from one read. A file that is not JSON is refused with its parse error and its revision.
- **`plan_info`** (read-only): the same as the CLI's `info`.
- **`validate_plan`** (read-only): **exactly one** of `path` or `plan` (inline JSON); both or neither gives `USAGE`. The strict rules of the CLI's `validate`. A file gives its `revision`; an inline plan has no revision.
- **`render_preview`** (read-only): `path`, optional `crop` (four numbers in mm, can be negative), `width` (1 to 2000 px, default 1200), `grid`, `dimensions`, `text`. The height follows the crop: the image must be at most **2000 px high and 4 million px**, or it is refused with the size it would have. Returns the PNG as image content, with `revision`, `width`, `height` and `warnings`.
- **`create_plan`** (writes): an empty plan or the sample. It never replaces: an existing file is refused (there is no `replace` in MCP). Creation is exclusive under the lock.
- **`write_plan`** (writes, marked destructive): writes a whole plan. `plan` is required. **Missing file:** with no `expectedRevision`, creation is exclusive under the lock; with an `expectedRevision` (the caller saw a file that is now gone), it is refused with `REVISION_CONFLICT` and `currentRevision: null`, and nothing is created (two creators at once: one writes, the other is refused with `DESTINATION_EXISTS`, the code that the CLI uses). **Existing file:** `expectedRevision` is required (without it, `DESTINATION_EXISTS`: the caller meant to create the file, as the second of two creators) and must equal the revision of the current bytes (`REVISION_CONFLICT` with `currentRevision`). A version 1 plan is refused (`NOT_VERSION_2`; use `migrate_plan`). The plan is validated with the strict rules before anything is written; a refusal writes nothing. A replaced file is backed up first, and a failed backup refuses the write. If the normalized plan equals the normalized current plan, the file is not written: its bytes and revision stay. The file is written in the normal format (`planText`).
- **`apply_commands`** (writes, marked destructive): `path`, `expectedRevision`, `commands`, with the same rules as the CLI's `apply` (atomic batch, backup, unchanged plan not written).
- **`migrate_plan`** (writes, marked destructive): `source`, `destination` (both inside the root). **Missing destination:** with no `expectedRevision`, exclusive creation; with an `expectedRevision`, `REVISION_CONFLICT` with `currentRevision: null`, and nothing is created (the caller meant to replace a version that it saw). **Existing destination** (also `source` itself, for an in-place migration): `expectedRevision` of the destination is required and must match, in place of the CLI's `--replace`; the destination is backed up first. The result gives the new revision and the migration report.
- **Annotations:** `readOnlyHint` on the read-only tools; `destructiveHint` on `write_plan`, `apply_commands` and `migrate_plan`; `create_plan` is not destructive (it never replaces). Each write tool description says when a backup is made: a **replacement** backs up the previous file first; a **first creation** has no previous file, so it makes no backup.

**Guide for MCP:**

- **Instructions (short):** the intro, the image-to-plan rules and the tool loop, and how to get the full guide: the `get_guide` tool, the resource `open-plan://guide`, or the prompt `convert_floor_plan_image`. The tool descriptions alone are enough for basic use (fields, the revision rule, what each tool refuses).
- **Command contracts are separate from the transport.** `commands.md` keeps only the contracts of the commands (fields, effects, refusals, example `commands` lists). The batch envelope moves to the transport fragments: `cli.md` (`commands.json` and `apply`) and a new `mcp.md` (the `apply_commands` arguments, the tool names and the result shapes, with no command files). The forms `text`, `agents-md`, `skill` and `llms` use `cli.md`; the new form `mcp` uses `mcp.md`.
- **Tests:** the existing guide tests also cover the `mcp` form; the MCP envelope example, each example batch and the refused example run **through the built stdio server** with real revisions, not only through the CLI.
- **Setup:** one line or config entry per agent, each with the local command and an absolute `--root`, written after the current documentation of each agent is checked. The package is not published, so the examples use the local install until a package name is chosen.

**Tests in C5a:** Vitest, through the SDK client over stdio to the built `dist/cli.js`: every tool; MCP results equal to the CLI `--json` results for the same operation; all the contract cases above (`write_plan`: two creators at once, an external edit before a replacement, a missing and a stale revision, an `expectedRevision` for a missing file, an unchanged plan, a failed backup; `migrate_plan`: a destination deleted between the caller's read and the locked operation; each input limit, with a file larger than the limit read only up to the limit); the workspace cases. The packed install test starts `mcp`, does the handshake, one read (`read_plan`) and one write (`apply_commands`), and checks that stdout has only MCP messages.

**Implementation (C5a):**

- **Server:** `open-plan mcp [--root <folder>]` (`packages/cli/src/mcp.ts`, the SDK's low-level `Server` and stdio transport). The tools are in `mcp-tools.ts`, which calls the shared operations; the boundary is in `workspace.ts`. Input schemas are closed (`additionalProperties: false`), and each handler checks its arguments again (`USAGE`): only own argument names are accepted (found in the C5a review: `{"constructor": 1}` and `{"__proto__": 1}` were accepted). The SDK's request parsing drops an own `"__proto__"` key, so the server answers such a call itself, before that parsing, with the same argument check (`USAGE`). It keeps no state per request: a first fix kept the raw arguments until the handler ran, and a request that the SDK refused left them in memory (C5a review). Requests run at the same time; the plan lock orders the writes.
- **Shared operations:** `applyBatch` and `renderPng` as decided; new `readPlan`, `validateValue` and `writePlan`. The operations take `OpOptions` (`maxBytes` for bounded reads, `boundary`); the CLI passes none, so its behaviour stays, with one change: **`new` and `migrate` now create a new file exclusively** (a file that another program makes in the meantime is kept, and the result is `DESTINATION_EXISTS`).
- **Boundary details found in the work:** the boundary is checked **before the lock too**, because the lock file is created next to the plan (a test holds a lock on the outside file and requires an immediate refusal); a read through a checked path checks after the read that the path still resolves to itself (`PLAN_PATH_CHANGED`), so a folder replaced by a link gives nothing of the outside file; a path outside the workspace is refused before any file check, so a missing file outside is not reported as missing. Only a **symlinked** backup folder is refused; a file in its place makes the backup fail (`BACKUP_FAILED`), as in the CLI.
- **Contract fix:** `write_plan` on an existing file with no `expectedRevision` gives `DESTINATION_EXISTS`, not `REVISION_REQUIRED` (the decision above had both for the second of two creators).
- **Guide:** `commands.md` has only the command contracts; `cli.md` and the new `mcp.md` have the batch envelope and the refused example of their transport; `mcp-intro.md` has the MCP work loop. `guide --form mcp` gives the MCP form (also the `get_guide` tool, the resource and the prompt). The instructions are the MCP intro and the image rules (about 3,000 characters). **The setup line for each agent is not in the guide yet:** it is written and tested in C5c.
- **Package:** the SDK 1.32.1 and zod 4.6.5 are exact dev dependencies, bundled; `dist/THIRD-PARTY-NOTICES.txt` has the license of each bundled npm package (the SDK, ajv, ajv-formats, fast-deep-equal, fast-uri, json-schema-traverse, zod, zod-to-json-schema), from the build's input list; the build fails if one has no license file. The bundle is about 820 KB (about 597 KB from these packages). No HTTP transport is in it.
- **Tests:** `mcp.test.ts` (25, through the built server over stdio; one sends 20 malformed calls with 1 MB arguments, own `"__proto__"` keys, and then a valid call), `mcp-boundary.test.ts` (5, in process with a hook between the check and the I/O, and a backup folder replaced by a link out **while the write waits for the lock**), 4 new guide tests (the MCP form; the reference has no transport; the MCP part names every tool; every example, the MCP envelope and the refused batch through `apply_commands`). The packed install test runs the installed `mcp`: the handshake, `read_plan`, `apply_commands`, and only JSON-RPC messages on stdout. Twelve mutations each make the MCP tests fail: `in` in place of an own-name check, no direct answer for an own `"__proto__"` key, the boundary before the lock, the check after a read, the bounded read, the `write_plan` revision check, the missing-destination conflict of `migrate_plan`, the refusal before the file check, the symlinked backup folder, the command count limit, the containment of the canonical path, and replacement by `expectedRevision` in `migrate_plan`.
- **Known limits:** the stdio transport of the SDK reads a whole message before the tool sees it, so the inline limits stop the work, not the memory use of one very large message. Under the lock, two checks refuse a change made while a write waits: the boundary after the lock is taken, and the boundary after the plan is read. Each one alone refuses it, and the test fails only when both are removed; for MCP, no write reaches the lock without one of them.

**Acceptance (C5b):**

- **Concurrent writers** (`packages/cli/test/mcp-acceptance.test.ts`), each on one file, with 50 CLI processes and 50 MCP calls through 5 server processes, while a reader reads the file again and again (about 3,000 to 13,000 reads per run): (1) **100 calls with the same starting revision:** exactly one succeeds, the other 99 get `REVISION_CONFLICT` with the winner's revision, one backup holds the plan before it, and the file has the winner's change. (2) **100 callers that read the revision, send, and on `REVISION_CONFLICT` read again and send again** (they start 10 ms apart, CLI and MCP in turn): all 100 succeed, about 1,300 conflicts on the way; no two successes start from one revision (no lost update), and the successes link from the first revision to the file's revision as **one sequence of 100 revisions**; the plan has all 100 new items; the 20 backups kept are the plans before the last 20 successes. In both, every read is complete JSON, every revision that a reader saw is the first one or one that a success gave, no temporary or lock file is left, and the file passes `validate`. Two mutations make both tests fail: no lock (lost updates), and a plan written in place instead of by an atomic rename (the reader sees part of a file).
- **Backups of MCP writes:** `apply_commands`, `write_plan` and `migrate_plan` that replace a plan, and a CLI `apply` between them, each leave exactly one backup with the bytes before it, in one folder; a new file and a write that changes nothing make no backup; a failed backup refuses each MCP write and changes nothing; after 22 MCP writes the 20 newest backups are kept; `restore` brings back a plan from an MCP backup, and `read_plan` gives its revision.
- **Live update** (`tools/checks/mcp-serve.mjs`, 13 checks, Chrome 155): an MCP `apply_commands` and an MCP `write_plan` appear in the editor that `serve` opened within 1 s, and loading them writes nothing back. The time is measured **from just before the MCP call** (the watch starts before the call, so a slow MCP response cannot hide a slow update; found in the C5b review): 37 to 78 ms in 3 runs, 23 to 60 ms from the file change. A mutation that delays each change event of `serve` by 1.5 s makes the three timing checks fail (1,529 to 1,572 ms). Also: an edit in the editor is saved, and an MCP batch with the revision from before it gets `REVISION_CONFLICT` and leaves the edit; after reading again, the batch is written and the edit stays; an MCP change during a drag shows the conflict message, as a CLI change does; after the editor is closed, `restore` of an MCP backup brings back the earlier plan, and a new editor and `read_plan` show it.
- **Test run:** the acceptance file starts about 2,500 processes in about 30 s, so Vitest runs it alone in a second group after the other files (`vitest.config.js`, project `acceptance`); in the same group as the others, it made 5 other tests time out.

**Decisions (C5c review, 2026-10-08; with the Codex reviewer, approved by the user):**

- **Agents:** full runs with **Claude Code and Codex only** (the installed ones: Claude Code 2.1.285, Codex 0.160.0). **Gemini CLI, Cursor and OpenCode are not tested in C5c**; they move to **C5d**, a later task that the user starts (each can need an account or a key). Step C stays partly open until C5d, or until the user accepts them as an exception; no record says that Step C is closed before that.
- **Build provenance:** a fresh build at the C5c commit, then the pack (`pnpm pack` alone can package an old `dist`). Recorded: the commit, the tarball hash, the installed `dist/cli.js` hash, the image hash, the exact prompt, the MCP configuration of each client, the model and reasoning settings, and the client versions. Each agent gets its own folder outside the repository with the installed package; the files stay in `~/Documents/open-plan-agent-exercises/<date>-c5c/`.
- **Image:** the same MIT-licensed image as C4b (same SHA-256). The record says that the guide (C4 follow-up), the models, the reasoning settings and the client versions can differ from C4b, so a comparison with C4b is not a controlled CLI-against-MCP accuracy comparison.
- **MCP-only, by configuration where possible:** **Claude Code:** `--tools "Read"` (the only built-in tool, to see the image; `--allowedTools` only gives approval, it does not remove tools), `--strict-mcp-config` with only the Open Plan server, and `--allowedTools` for Read and the Open Plan tools; the tool list that the session actually gets is checked before the run. **Codex:** the features `shell_tool` and `unified_exec` are turned off if a test first shows what that removes; turning off the shell may not remove direct file editing. For both, the log decides: a CLI call or a direct write of a plan file makes the run **mixed access**, not an MCP-only pass; it is run again, or the criterion stays unmet. Human help is recorded apart from the agent's own corrections.
- **Isolation:** which instructions each client actually loads is checked and recorded (a fresh folder alone does not prove it).
- **Server details per client:** a small wrapper records the working directory and the arguments that the client gives to `mcp`, and the setup line or config entry that worked.
- **Ten-tool checklist:** through each real client, on test files, every one of the ten tools is called and **gives its expected result** (also `create_plan`, `migrate_plan`, `get_schema`, `plan_info`); a failed call is not coverage, and for a write tool the resulting file is checked. Whether the client can use the guide resource and the `convert_floor_plan_image` prompt is recorded.
- **Live:** `serve` is already open on the plan before a later MCP change by the agent, and that change appears in the open editor. The final plan is checked in 2D (label widths, overlay, as in C4b) and in 3D (heights).
- **Visual check:** a human review is not required for the Step C MCP criterion. The record gives the automated 2D and 3D checks and the known geometry errors, and says whether a person looked; a check that nobody did is never called passed. Validity and client compatibility are not drawing accuracy.
- **Guide:** a setup section with one tested line or config entry for each tested client (Claude Code, Codex), checked against each client's current documentation. A test of `mcp --root` checks only the server command; the real connection is the proof of each setup line.
- **Full-run gate:** the plan is written through the MCP tools, and the final plan **passes `validate_plan` and the CLI `validate`, imports in the website, and shows in `serve`**.
- **What blocks closing the MCP criterion:** the three untested clients; any of the ten tools not covered through both Claude Code and Codex; a full run that does not pass the full-run gate.
- **Record:** `docs/agent-exercises/<date>-c5c-mcp.md`, a C5c note here, and the Step C status.

### Step C done when

- **Core:** the browser app and the CLI give the same validation result on all B2 fixtures. Each command has a node test, and a batch with one bad command changes nothing.
- **CLI loop:** in a test, a scripted "agent" writes a plan with 3 errors, reads `validate --json`, corrects them, and `render` gives a PNG that matches a stored reference.
- **Live file mode:** an external file edit appears in the open browser within 1 s. A browser edit is written to the file. A conflicting write is refused and the message is shown.
- **Concurrent writers:** 100 parallel `apply` calls from the CLI and MCP on one file give 100 sequential revisions or `REVISION_CONFLICT` results, and the file is always valid JSON. A truncated or invalid file written directly leaves the browser on its last valid plan with autosave stopped; when the file is valid again with an unsaved browser edit, the conflict message appears and nothing is lost.
- **Backups:** each CLI or MCP write and each replacement leaves one backup; a failed backup write refuses the write; pruning keeps 20; `restore` brings back an earlier plan after a browser restart; `new` refuses an existing file without `--replace`.
- **Security:** requests with no token, a wrong token or a wrong `Host` header are refused; a path outside the plan file is refused; the server does not listen on the LAN without `--host`.
- **MCP:** the server connects and all tools work in at least **Claude Code and Codex**, end to end from a real floor-plan image to a valid plan shown in `serve`. For Gemini CLI, Cursor and OpenCode, connection and `validate_plan` are tested. Record the agent versions and results.
- **Guide:** an agent in scope, with only the guide and a floor-plan image, makes a plan that passes `validate`. Record the agent, the image and the errors it corrected by itself.

**Status (2026-10-08, after C3):**

- **Core parity:** `apps/web/test/validation-parity.test.js` sends every B2 fixture (shared from `packages/core/test/validation-fixtures.ts`), four v1 files and two unreadable files through the website's import (`readImportFile`) and saved-plan load (`loadDocument`) and through the built CLI (`validate`, `info`). All 71 give the same issues (code, path, params, order): 44 blocking, 21 tolerable (an import error, a saved warning), 6 valid. Mutations of the CLI policy and of the website's v1 path each make it fail.
- **Live file mode:** `tools/checks/serve.mjs` now requires an external change to appear within 1 s: 33 to 58 ms with the folder watcher in 5 runs (CLI apply and a direct write). With the watcher turned off (the 1 s check alone), 114 to 833 ms in 9 runs; the fallback is not a guaranteed deadline (C3). In 1 of those 9 runs, "page close" failed once; it has not failed with the watcher on.
- **Met:** CLI loop, backups (CLI part), security, the CLI part of concurrent writers, and the invalid-file part. **Guide:** met by C4b (2026-10-08): two agents, using the supplied guide, the image and the CLI, made plans that pass `validate`; Codex had no instruction file and used only shell commands, and Claude Code likely also had the user's global `CLAUDE.md` (writing style and `CONTEXT.md` rules, nothing about plans), as corrected in the record. **Concurrent writers and backups, MCP part:** met by C5b (2026-10-08). **Wait for C5c:** MCP with real agents.

## Step D: background image, calibration and editing

**Goal:** the user can see and correct the agent's errors.

### D1. Background image

- Import the floor-plan image as a locked layer under the plan, with opacity control.
- **Identity:** the plan stores `background: { imageId, mime, transform, opacity }`. `imageId` is the SHA-256 hash of the image bytes. The plan never contains the bytes.
- **Website:** the bytes are in **IndexedDB**, keyed by `imageId` (localStorage has a limit of about 5 MB).
- **`serve` mode:** the bytes are in a file next to the plan: `<plan>.assets/<imageId>.<ext>`. The CLI and MCP tools use the same folder.
- **Missing image:** the plan opens normally. The layer shows 找不到底圖 with an action to select the image again. If the selected file has a different hash, the app asks for confirmation, then **updates `imageId`** (one undo step), so the stored identity stays correct.
- **Export and import:** export is the plan JSON only by default, or a **bundle** (one file with the plan and its image). Import accepts both. A plan JSON whose image is missing opens with the 找不到底圖 state.

### D2. Image alignment

Two image points and one length give only the scale. Alignment needs **pairs of points**.

- The user clicks an image point, then the matching plan point (for example a wall corner). Two pairs give scale, rotation and position. The app moves the image; the plan does not change.
- Manual controls also exist: move, rotate in 90° steps and in fine steps, and scale.
- A third pair, if given, shows the remaining error in mm, so the user can see if the image is distorted.

### D3. Plan scaling (when the agent's scale is incorrect)

- The user clicks two plan points and types the real distance between them. The **pivot** is the first point.
- **These fields scale:** wall `a`, `b` and `thickness`; opening `offset` and `width`; room `poly` and `at`; furniture `cx` and `cy`; measurement `a` and `b`; dimension chain `at`, `start` and `segments`.
- **These fields do not scale:** furniture `w`, `d` and `rot` (real objects keep their size); door `hinge` and `swing`; all heights; materials and prices.
- Wall thickness scales because the agent measured it from the same image with the same scale error.
- **The background image scales too**, with the same pivot, when it has a transform. This keeps the image aligned with the plan.
- Results are rounded to 0.1 mm, the same as L19. The scaling is one undo step.
- **The validator runs on the result before it is applied.** If the result has errors (for example a wall thickness above 1000 mm, or a plan larger than 100 × 100 m), the scaling is **refused with no change**, and the errors are shown. Tolerable issues (for example furniture now outside all rooms) are shown as warnings.

### D4. Editing

- **Walls:** move end points, change thickness, add and delete walls, split and join, reverse, change the type. The behaviour follows the wall and opening rules in C1.
- **Openings:** drag along the wall or to another wall (`move_opening`), resize (`resize_opening`), change the type (`change_opening_type`), add and delete, change door `hinge` and `swing`. Openings stay inside their wall.
- **Rooms:** move polygon points; add and delete rooms.

### Step D done when

- A user can start from an agent's plan with a scale error of 10% and one extra wall, align the image with two point pairs, and correct both errors in under 5 minutes.
- After plan scaling, furniture keeps its size, the background image stays aligned, and all scaled fields match a node reference calculation. A scaling with an invalid result changes nothing.
- Selecting a different image file for a missing background updates `imageId` after confirmation, and the change can be undone.

## Step E: remote MCP server (later)

**Goal:** chat-only agents can read and write a plan in the user's account, with no file copy.

- Only after Open Plan has accounts and cloud storage. The donor project (`donor/mamezu/docs/remote-mcp.md`) shows a full design: Streamable HTTP, OAuth with PKCE, dynamic client registration, `expectedRevision` conflict checks and usage limits.
- It serves **chat-only agents** (claude.ai, ChatGPT web), which cannot run the local tools in Step C. It reuses the Step C commands and tool list; only the transport, accounts and storage are new.
- Step B gives most of the value without a server. Do not start Step E before Steps B and C have real users.

## Decisions and open questions

**Decided (2026-10-06):**
- **First plan:** empty plan with Import plan and Load sample apartment; returning users reopen their saved plan (B3).
- **Privacy text:** a task, with mode-aware wording, beside image import and the agent prompt (B3, D1).
- **Website and `serve`:** separate storage modes, transfer by export and import, a visible mode indicator, and backup and recovery in each mode (C3).
- **Diagonal walls** (v3): format ready, renderer later. **Wall format** (v3): centre lines only.
- **Repository** (v7): pnpm monorepo; TypeScript for `packages/core` only; Vitest for core logic; a separate browser harness for pixel compares; private root `open-plan-workspace`.

**Decided after a test:**
- **Large-plan shadows (2026-10-07):** keep shadows at all plan sizes, from the 100 × 100 m record in Step A (softness, artifacts, edges, frame rate). Check again on real GPU hardware before a release.
- **Intermittent import-check failure (found 2026-10-07, cause found 2026-10-08): a race in the test, not in the app.** In `tools/checks/import.mjs`, Enter on the focused 匯入 button sometimes opened no file chooser (2 of about 20 full runs; after the 2026-10-08 additions, about 1 in 4). An event log in the page showed the same app behaviour in passing and failing runs: a trusted Enter, a trusted click on the button, and `click()` on the file input with user activation. Only in the failing runs, the input then got a `cancel` event 1 ms later: Chrome opened the chooser and closed it at once. Playwright makes Chrome intercept file choosers only while a `filechooser` listener exists, and turns this on asynchronously; `keyboard.press` is sent at once, so the Enter could reach Chrome before interception was on, and headless Chrome then closes the chooser by itself. Mouse steps did not fail because `click()` waits for the element first, which gives interception time. **Fix (test only):** one `filechooser` listener for the whole keyboard section, and one round trip to the page after it is added. The app was not changed.

**Closed:**
- **Real-image exercise (Step B, "Real image"), 2026-10-08:** done in C4b (see the C4b note and its record). The user closed the item without a separate visual review.

**Open:**
- **Focus after Escape in the import dialog, development build only (found 2026-10-08).** With a React development build (`pnpm dev`, or a build with `NODE_ENV=test`), focus does not go back to the 匯入 button when Escape closes the dialog; `tools/checks/import.mjs` then fails "keyboard: focus goes back to the 匯入 button". The production build passes, and C3a has the same behaviour. Probable cause: StrictMode runs effects twice in development, and the focus return in `PlanImport.jsx` (a microtask that skips an inert opener) runs at the wrong time. Not fixed in C3b.
- **Package name.** Check on 2026-10-06: `open-plan` on npm is **taken** (version 1.0.0, a Markdown plan review CLI, not related). `@open-plan/cli` is not published, but that does not show that the `@open-plan` scope is free or that we control it. **Before publishing, choose a scope that we control.** Until then, examples use `<package>` and `<cli>`.

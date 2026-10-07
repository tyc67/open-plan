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
| `<cli> render plan.json out.png [--crop x0,y0,x1,y1] [--grid]` | Draws the plan in 2D, optionally with a 1 m grid and dimensions, so an agent can compare it with the source image |
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

### C5. Local MCP server (stdio)

`npx <package> mcp`, started by the agent. Setup is one line or one config entry per agent, for example `claude mcp add open-plan -- npx <package> mcp`. The guide gives the setup for each agent in scope.

| Tool | Read-only | Notes |
| --- | --- | --- |
| `get_schema` | yes | Schema and field description |
| `read_plan` | yes | Plan JSON and revision |
| `plan_info` | yes | Counts, size, rooms with areas |
| `validate_plan` | yes | A path or inline JSON; returns errors and warnings |
| `render_preview` | yes | Returns a PNG image, optional crop and grid |
| `create_plan` | no | Empty or sample; refuses to write over an existing file |
| `apply_commands` | no | Needs `expectedRevision`; returns the new revision or `REVISION_CONFLICT` |
| `migrate_plan` | no | v1 to v2 with report |

- Tools work on plan files **inside the agent's working directory only**. Paths outside it are refused.
- The server sends the agent guide as `instructions` at start, and offers it as a resource and as a prompt (`convert_floor_plan_image`).
- Tool annotations mark read-only and destructive tools, so agents can ask the user before a write.
- When `serve` runs for the same file, the browser shows MCP changes live through C3. No extra link is needed.

### Step C done when

- **Core:** the browser app and the CLI give the same validation result on all B2 fixtures. Each command has a node test, and a batch with one bad command changes nothing.
- **CLI loop:** in a test, a scripted "agent" writes a plan with 3 errors, reads `validate --json`, corrects them, and `render` gives a PNG that matches a stored reference.
- **Live file mode:** an external file edit appears in the open browser within 1 s. A browser edit is written to the file. A conflicting write is refused and the message is shown.
- **Concurrent writers:** 100 parallel `apply` calls from the CLI and MCP on one file give 100 sequential revisions or `REVISION_CONFLICT` results, and the file is always valid JSON. A truncated or invalid file written directly leaves the browser on its last valid plan with autosave stopped; when the file is valid again with an unsaved browser edit, the conflict message appears and nothing is lost.
- **Backups:** each CLI or MCP write and each replacement leaves one backup; a failed backup write refuses the write; pruning keeps 20; `restore` brings back an earlier plan after a browser restart; `new` refuses an existing file without `--replace`.
- **Security:** requests with no token, a wrong token or a wrong `Host` header are refused; a path outside the plan file is refused; the server does not listen on the LAN without `--host`.
- **MCP:** the server connects and all tools work in at least **Claude Code and Codex**, end to end from a real floor-plan image to a valid plan shown in `serve`. For Gemini CLI, Cursor and OpenCode, connection and `validate_plan` are tested. Record the agent versions and results.
- **Guide:** an agent in scope, with only the guide and a floor-plan image, makes a plan that passes `validate`. Record the agent, the image and the errors it corrected by itself.

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

**Open:**
- **Real-image exercise (Step B, "Real image").** Not done: it needs a real floor-plan image and an agent. Step B is not closed until it is recorded.
- **Intermittent import-check failure (2026-10-07).** In `tools/checks/import.mjs`, the keyboard step timed out in 2 of about 20 full runs: Enter on the focused 匯入 button opened no file chooser. The same step alone passed 25 of 25 runs, so it depends on the earlier steps of the check. The cause is not known, and it can be in the app or in the test. The check now asserts the file chooser and reports where focus was before and after Enter; 10 full runs then passed, but that change can also change the timing. Find the cause before Step B is closed.
- **Package name.** Check on 2026-10-06: `open-plan` on npm is **taken** (version 1.0.0, a Markdown plan review CLI, not related). `@open-plan/cli` is not published, but that does not show that the `@open-plan` scope is free or that we control it. **Before publishing, choose a scope that we control.** Until then, examples use `<package>` and `<cli>`.

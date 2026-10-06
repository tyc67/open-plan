# Open Plan

Independent local floor-plan editor initialized from the Mamezu codebase and the floorplan-3d apartment reference. This repository starts with fresh Git history and no remote.

## Run

```sh
pnpm install
pnpm dev
```

Build with `pnpm build`; preview with `pnpm preview`.

The React editor displays the reference apartment in an SVG 2D plan and a Three.js 3D view. Switch views with the floating canvas toolbar. The workspace reuses Mamezu’s tab rails, collapsible panels, scrollable toolbar, and tooltips, with local appearance preferences and a project name field. In 3D, orbit, zoom, pan, adjust wall height, and click furniture to select it; drag selected furniture to move it. Both views share the same document and undo history. Add, select, drag, resize, rotate, and delete furniture; undo/redo; export document JSON. Coordinates are millimetres. Local autosave uses `open-plan:document:v1`; data belongs to the browser origin and is not uploaded. JSON import is not implemented yet.

## Layout

- `src/workspace/`: Mamezu-derived workspace shell, tab rails, panel wrappers, scrolling toolbar, and tooltips. Desktop side panels collapse; on mobile one panel opens over the canvas. UI preferences use `open-plan:workspace:v1`.
- `src/floorplan/document.js`: versioned floor-plan document factory and validation.
- `src/floorplan/seed.js`: original apartment geometry, materials, and furniture library.
- `src/floorplan/FloorPlanEditor.jsx`: React entry and 2D interactions.
- `src/floorplan/DimensionLines.jsx`, `dimensions.js`, and `usePlanViewport.js`: reference perimeter dimension chains, nominal 1:60/1:100 display presets, current scale and scale bar, with scale preserved across panel resizes. Ratios follow the reference’s 96 CSS px/inch convention; physical monitor dimensions and browser zoom can change their apparent size.
- `src/floorplan/OpeningSymbols.jsx`: reference-style hinged door leaves and dashed swing arcs, sliding-door panels, window frames, and entrance marker.
- `src/floorplan/FurnitureSymbol.jsx` and `furnitureSymbols.js`: detailed reference furniture symbols rendered as native React SVG nodes, including pillows, blankets, cushions, cabinet divisions, and appliance details.
- `src/floorplan/FloorPlan3D.jsx` and `three/`: React-managed 3D viewer, procedural furniture, floor textures, architecture, and coordinate conversion. Three.js is installed locally; the active viewer has no CDN dependency.
- `src/floorplan/storage.js`: isolated local persistence adapter.
- `reference/floorplan-3d.html`: unchanged visual and behavioral reference, including its CDN-dependent 3D viewer.
- `donor/mamezu/`: complete tracked source snapshot from Mamezu, retained for incremental migration. Its application, cloud configuration, and deployment scripts are not part of the active app.

## Next migration steps

1. Extract domain commands and undo/session hooks from the editor.
2. Adapt Mamezu IndexedDB and project lifecycle adapters to floor-plan documents; add multiple projects and import/export validation.
3. Extend the 3D viewer with walkthrough mode, animated doors, and lighting controls.
4. Add wall/opening editing, snapping, room materials, and measurement tools.

The 2D furniture symbols reproduce the reference geometry and colors, with upright furniture labels and a separate selection outline. Door leaves, dashed swing arcs, sliding-door panels, window frames, and perimeter dimensions also match the reference. Dimensions are millimetres and can be toggled; view controls include 1:60, 1:100, and fit-to-view. Room floor patterns, gesture navigation, and some 3D features remain to be ported. Orbit viewing and detailed procedural furniture are available; walkthrough mode and animated view transitions remain future work. Source attribution and donor third-party notices are retained under `donor/mamezu/`; check them before redistribution.

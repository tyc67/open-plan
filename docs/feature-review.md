# Open Plan feature review

As of 2026-10-06.

## State on 2026-10-11 (read this first)

This review is from 2026-10-06, before Steps A to D of the roadmap. Its file names and line numbers are from that date; several of the files do not exist now (the plan model moved to `packages/core`). The table below gives the state of each finding that was not "Fixed" in the tracking table. **The state comes from a reading of the code on 2026-10-11. No finding was reproduced in a browser on that date.**

| ID | State on 2026-10-11 | Basis |
| --- | --- | --- |
| L1 | Open | The cut level in 3D is local state (`FloorPlan3D.jsx`, `cutLevel`), not stored. |
| L3 | Needs repro | Not checked again. |
| L6 | Partly corrected (2026-10-11) | Corrected: website mode saves a waiting edit when the page hides or closes (`pagehide`, `visibilitychange`), and autosave in both modes writes only committed data (before, a furniture or label drag that stopped for 400 ms stored its preview; check `tools/checks/save-on-hide.mjs`, and `serve.mjs` for file mode); a save that fails is tried again at the next hide. Limits: the browser does not always send these events, so the save at close is best effort; a typed value that is still in its field is not saved; an edit from another path during a furniture or label drag (for example a keyboard action while the pointer is down) is made from the plan with the preview, so that preview is then committed and saved (older behaviour, not changed). Still open: no sync and no conflict check between two tabs (the last tab to save wins with no warning). |
| L7 | Partly corrected | The English save and load messages are gone. The hint of the measure tool still takes the place of the status line. |
| L8 | Open | `startMeasure` checks only the lock of the dimensions layer, not if the layer is shown. |
| L9 | Open | `containsPoint` (now in `packages/core/src/rooms.ts`) is true on an edge. |
| L10 | Corrected by Step A | An opening belongs to a wall (`wallId`), and the openings of a demolished wall are not in the drawing geometry. |
| L11 | Open (design) | Room outlines do not change when a wall is demolished or deleted. Since D4 the user can change the outline. |
| L12 | Open | A stored `#abc` colour is shown correctly, but a typed `#abc` is still refused. |
| L13 | Open (design) | Not changed. |
| L14 | Not checked | The cost dock was not read for this. |
| L15 | Open | `three/viewer.js` has a `webglcontextlost` handler and no `webglcontextrestored` handler. |
| L16 | Partly corrected | The heights: corrected by Step A. Lintels and sills come from the heights of each opening (`three/models.js`). The other part of the finding is open: the `bearing` option is still passed to the 3D model (`FloorPlan3D.jsx`, `three/viewer.js`), and a change of it builds the model again, but it does not change what is drawn. |
| L17 | Open | The export file name is always `open-plan.json`. |
| L18 | Open | The price field handles Enter with no IME check. |

Later limits and open points (Steps A to D) are in `docs/plan-import-roadmap.md`, not here.

## Summary

The review found **5 high-severity defects**, 4 medium and 14 low in the existing features. A later fix review found 1 more low finding (L19). L2, L4, L5 and L19 are fixed, so 11 low findings are open. **All 5 high and all 4 medium defects are fixed** (see the **Fix** line under each). Four more items are not confirmed defects: 3 design decisions and 1 that needs a browser repro.

- **Scope:** all features of the active app in `src/` (2D editor, 3D view, workspace, cost estimate). The `donor/` and `reference/` folders are out of scope.
- **Method:** first a read-only code review in three parallel parts, then a second review of the findings, then the fixes. Some math was checked with small node scripts.
- **Testing:** H1, H4, L4 and L5 were reproduced in headless Chrome before the fix. All 13 fixes were verified in headless Chrome; the H3 validation and L19 also with node cases. The open low findings were not tested in a browser, and each comes from one reviewer.
- **IDs:** H = high, M = medium, L = low. File references are `path:line` at the time of the review, relative to `src/floorplan/` or `src/workspace/`. M4 was H5 in the first version.

### Revision history

- **v2 (2026-10-01):** H5 moved to medium as M4. L3 needs a browser repro. L10, L11 and L13 moved to design decisions. The "found sound" section is narrowed to the reviewed cases, with four corrections.
- **v3 (2026-10-01):** H1 and H4 reproduced in headless Chrome. M4 rounding policy decided.
- **v4 (2026-10-01):** H2, H3 and H6 fixed and verified in headless Chrome. See the **Fix** line under each.
- **v5 (2026-10-01):** H1, H4 and M4 fixed and verified in headless Chrome, as three separate fixes.
- **v6 (2026-10-02):** a fix review found two H3 validation gaps: invalid material entries and out-of-range estimate values. Both are now rejected at load. The summary is updated to match v4 and v5.
- **v7 (2026-10-02):** M1, M2 and M3 fixed and verified in headless Chrome. M2 limit recorded (bug not reproduced before the fix). New low finding L19 (float noise in snapped positions).
- **v8 (2026-10-02):** L2 fixed and verified in headless Chrome.
- **v9 (2026-10-06):** L19 fixed and verified. Not a finding: new IDs now work over plain HTTP on the LAN (`src/floorplan/ids.js`), because `crypto.randomUUID` exists only in secure contexts.
- **v10 (2026-10-06):** L5 fixed and verified in headless Chrome.
- **v11 (2026-10-06):** L4 reproduced and fixed, verified in headless Chrome.
- **v12 (2026-10-06):** outdated parts corrected: the date, the testing line, the L19 text and the order of this history.

## Tracking

One row per finding. Change **Status** (`Open`, `Needs repro`, `Decision needed`, `In progress`, `Fixed`, `Won't fix`) as work moves. The detail for each ID is in the sections below.

| ID | Severity | Area | Defect | Location | Status |
| --- | --- | --- | --- | --- | --- |
| H1 | High | Editor | Inspector edit lost when you drag right after it | `FloorPlanEditor.jsx:141` | Fixed |
| H2 | High | Editor | Autosave off for the session after a load error; status still says saved | `FloorPlanEditor.jsx:107` | Fixed |
| H3 | High | Editor, 3D | No error boundary; weak validation or failed 3D load blanks the page | `document.js:18` | Fixed |
| H4 | High | Cost | Invalid number deletes a saved price; waste becomes 0% | `CostEstimate.jsx:6` | Fixed |
| H6 | High | Workspace | Fullscreen error hides all later status, incl. save failure | `WorkspaceShell.jsx:74` | Fixed |
| M1 | Medium | Workspace | Canvas shrinks to about 20 px at 768–1023 px width | `WorkspaceShell.jsx:67` | Fixed |
| M2 | Medium | 3D | On a phone, the selection panel blocks 3D drag | `WorkspaceShell.jsx:79` | Fixed |
| M3 | Medium | Editor | Space key cannot operate buttons or tabs in 2D | `FloorPlanEditor.jsx:228` | Fixed |
| M4 | Medium | Cost | Subtotals use unrounded quantity, not the shown value (was H5) | `CostEstimate.jsx:18` | Fixed |
| L1 | Low | 3D | Wall height resets on view switch or reload | `FloorPlan3D.jsx:8` | Open |
| L2 | Low | 3D | Esc and layer lock do not stop a 3D drag | `viewer.js:150` | Fixed |
| L3 | Low | 3D | Status bar covers the 3D hint (probably wrong) | `src/style.css:9` | Needs repro |
| L4 | Low | Editor | Number field adds an undo step with no change | `FloorPlanEditor.jsx:263` | Fixed |
| L5 | Low | Editor | Number fields ignore Enter | `FloorPlanEditor.jsx:263` | Fixed |
| L6 | Low | Editor | Autosave misses tab close; no sync between tabs | `FloorPlanEditor.jsx:106` | Open |
| L7 | Low | Editor | Save errors hidden while measuring; some errors in English | `FloorPlanEditor.jsx:256` | Open |
| L8 | Low | Editor | Measuring works while the dimensions layer is hidden | `FloorPlanEditor.jsx:73` | Open |
| L9 | Low | Geometry | Furniture on a shared room edge counts in two rooms | `roomGeometry.js:12` | Open |
| L10 | Design | Geometry | Doors in demolished walls stay as snap targets; no wall–opening rule exists | `Measurements.jsx:7` | Decision needed |
| L11 | Design | Cost | Flooring area ignores demolished walls (known limitation) | `CostEstimate.jsx:11` | Decision needed |
| L12 | Low | Panels | Short hex colour (`#abc`) rejected | `FurnitureAppearance.jsx:3` | Open |
| L13 | Design | Panels | Net area and purchase quantity are not labelled apart | `RoomProperties.jsx:11` | Decision needed |
| L14 | Low | Cost | Cost dock arrow key can do nothing on first press | `CostDock.jsx:13` | Open |
| L15 | Low | 3D | No recovery after WebGL context restore | `viewer.js:146` | Open |
| L16 | Low | 3D | Lintels and sill heights hard-coded, not from plan data | `three/models.js:696` | Open |
| L17 | Low | Workspace | Export file name is always `open-plan.json` | `FloorPlanEditor.jsx:254` | Open |
| L18 | Low | Cost | Price field Enter has no IME check (plausible) | `CostEstimate.jsx:6` | Open |
| L19 | Low | 3D, Geometry | Snapped positions can save float noise (e.g. 1789.9999999999998) | `wallSnapping.js` | Fixed |

## High findings

These five can lose data or make the app unusable. Fix them first. All five are confirmed: H1 and H4 in Chrome, H2, H3 and H6 in the code.

### H1. Inspector edit lost when you drag right after it

- **Defect:** `startDrag` and `startLabelDrag` store `before: doc` on pointerdown. The focused input's blur fires later (on mousedown) and commits the edit. Each drag move then calls `setDoc({...g.before, ...})` and writes over it.
- **Repro:** select a sofa, type 2000 in 寬度, then drag the same sofa at once. The width goes back to the old value. Name, colour and room name (then drag the room label) do the same. History then holds [orig, patched, orig].
- **Location:** `FloorPlanEditor.jsx:141`, `:169`, `:174`.
- **Verified:** confirmed in headless Chrome on 2026-10-01. Select 三人沙發 (width 3000), type 2000 in 寬度, drag the sofa at once: the saved width is **3000**. Control: press Tab first, then drag: the saved width is 2000.
- **Fix:** `startDrag` and `startLabelDrag` call `commitPendingEdit()` first. It blurs a focused inspector field, so its edit commits, then returns the latest document from a ref that `commit` updates at once. The drag starts from that document and from the item's edited position. Verified in headless Chrome:
    - Width 2000 then drag: width kept and the item moved.
    - Undo after that: first the move is undone (width stays 2000), then the width edit (back to 3000).
    - Depth 700 then drag and Escape: depth kept, no move.
    - X edit then a drag with no real movement: the new X is kept.
    - Room name 主臥 A then a label drag: name kept and the label moved.

### H2. Autosave off for the session after a load error

- **Defect:** the autosave effect returns early when `initial.error` is set, and that value never changes, also after a successful manual save. The manual save sets 已儲存到此裝置, so the user thinks autosave works.
- **Repro:** set `localStorage['open-plan:document:v1']='{bad'` and reload. Click 儲存到此裝置, move furniture, reload. The move is lost.
- **Also:** the manual save writes over the corrupt data with no backup copy.
- **Location:** `FloorPlanEditor.jsx:107`, `:243`.
- **Verified:** yes, in the code.
- **Fix:** a load error copies the raw data to `open-plan:document:v1:recovery` and pauses autosave. A manual save resumes autosave and shows 已儲存到此裝置，自動儲存已恢復. Verified: an edit before the save does not overwrite the bad data; an edit after the save survives reload. The load error text is now zh-TW.

### H3. No error boundary; one error blanks the page

- **Defect:** no component catches render errors. Two causes reach it:
    - The lazy 3D chunk does not load (offline, or an old hashed chunk after a new deploy).
    - `validateDocument` checks only furniture. Rooms without `poly`, walls without `rect`, measurements without `a`/`b`, and duplicate furniture ids all pass.
- **Repro:** go offline and click 3D, or save a doc with `rooms[0]={id:'x'}`. The page goes blank. A bad saved doc blanks it on **every reload**, so Save and Export cannot be reached.
- **Also:** with duplicate ids, move and delete act on both items.
- **Location:** `document.js:18`, `FloorPlanEditor.jsx:24`, `src/main.jsx`.
- **Verified:** yes. No `ErrorBoundary` or `componentDidCatch` exists in `src/`.
- **Fix:** `validateDocument` now checks walls, openings (door hinge data), rooms, materials, measurements, dimension chains, cost-estimate price maps and unique furniture ids. `src/ErrorBoundary.jsx` wraps the app (recovery page: download saved data, reload, set aside and start a new plan) and the 3D view (message + 返回 2D). Verified: a damaged doc fails at load and the editor renders; a blocked 3D chunk shows the fallback and 2D still works; a forced render crash shows the recovery page.
- **Limit:** after a failed 3D chunk load, 3D works again only after a page reload. Chrome keeps the failed import for the page's lifetime, so an in-page retry was tried and removed.
- **Follow-up fix (v6):** validation also rejects materials that are not objects with string `name` and `sw` (e.g. `materials.wood = null`, read by the material panel at `WorkspaceShell.jsx:109`), negative prices, and `wastePercent` outside 0–100. These are the same ranges as the estimate inputs. Verified with 11 node cases: the seed doc, waste 0 and 100, price 0 and null, and older docs without measurements or dimensions still pass.

### H4. Invalid number deletes a saved price

- **Defect:** `<input type=number>` reports `""` for text like `1e` or `1.2.3`. The code treats `""` as "clear" and commits `null`. It does not check `validity.badInput`.
- **Repro:** a price is 1200. Type `1e` and blur. The price is deleted and shows 未填. In the waste field, the same input sets waste to **0%** with no message.
- **Location:** `CostEstimate.jsx:6`.
- **Verified:** confirmed in headless Chrome on 2026-10-01, with 主臥室 雙人床 at a price of 1200:
    - `1e` → `validity.badInput` is true, the value is `""`, and **the saved price is deleted**.
    - `--5` → the same result: the price is deleted.
    - `1.2.3` → Chrome drops the second dot and the price is **saved as 1.23** with no warning. This is a related, smaller issue.
    - `1e` in the waste field → **`wastePercent` is saved as 0**.
- **Fix:** `NumberField` checks `validity.badInput` on blur. Unparsable text restores the previous value and commits nothing. An empty field without `badInput` is still an intentional clear. Verified in headless Chrome:
    - Price 1200, then `1e` or `--5`: the price stays 1200 and the field shows 1200.
    - Clearing the price on purpose removes it. `1e` in an empty field keeps it empty, and a later 350 saves.
    - Waste `1e`: waste stays 5. Clearing waste on purpose still sets 0 (unchanged behavior).
- **Not fixed:** Chrome changes `1.2.3` to 1.23 while you type. The field gets a valid number, so the app cannot detect it.

### H6. Fullscreen error hides all later status

- **Defect:** `notice` is never cleared, and the status bar shows `notice||status`.
- **Repro:** on an iPhone, tap 全螢幕. After that, 儲存失敗 and all other status text never show.
- **Location:** `WorkspaceShell.jsx:74`, `:144`.
- **Verified:** yes, in the code.
- **Fix:** the notice clears when the status changes and after 4 s. Verified: a save failure replaces the fullscreen notice at once.

## Medium findings

M1–M3 block a feature on some devices or for keyboard users. M4 shows misleading numbers. No data is lost. Fix these before you add more features.

### M1. Canvas shrinks to about 20 px at tablet width

- **Defect:** "one panel at a time" applies only below 768 px. From 768 to 1023 px, both side panels can be open.
- **Repro:** at 768 px width the left panel is open by default. Click a room. 340 + 320 + 88 px of rails = 748 px, so the canvas is about 20 px wide. A saved `rightOpen:true` restores this state on load.
- **Location:** `WorkspaceShell.jsx:25`, `:67`, `:79`.
- **Fix:** below 1280 px (`BOTH_PANELS_MIN_WIDTH`), only one side panel is open at a time. The right panel opens by default only from 1280 px. A saved state with both panels open loads with only the left one below 1280 px, and shrinking the window below 1280 px closes the left panel. At 768–1279 px, a selection does not close the furniture library, so you can add several items; from another left tab, a selection replaces it with the properties panel. Verified in headless Chrome:
    - Canvas width at load / after a room click: 768 px → 340 / 360; 1024 → 596 / 616; 1279 → 851 / 871; 1280 → 532 with both panels.
    - 1024 with saved both-open state: 596 px, left panel only.
    - 1024: two adds with the library open add 2 items and keep the library open.
    - Resize from 1440 (both open, 692 px) to 1024: the left panel closes, canvas 616 px.
    - 390 px (phone) is unchanged: one overlay panel.

### M2. On a phone, the selection panel blocks 3D drag

- **Defect:** a 3D drag starts only on furniture that is already selected. On a narrow screen, selection opens the right overlay, and its backdrop covers the canvas.
- **Repro:** on a phone, open 3D and tap a sofa. The panel covers the scene. You must close it, then drag. 2D touch drag does not have this problem.
- **Location:** `WorkspaceShell.jsx:79`, `:100`, `three/viewer.js:121`.
- **Fix:** below 768 px in 3D, a selection does not open the properties overlay. The tap selects (the 3D outline shows it) and the next drag moves the item. The properties stay one tap away on the right rail. Rejected option: start a drag on any furniture with one finger, because a one-finger orbit that starts on furniture would then move it. Verified in headless Chrome:
    - 390 px, touch: a tap selects 淋浴區, no overlay opens, and a one-finger drag moves it.
    - 1440 px, mouse: the properties panel still opens on selection, and the drag still moves the item.
- **Limit:** the original bug was not reproduced before the fix. The test shows that the new behavior works, but it gives limited evidence that the old failure is gone in every case.

### M3. Space key cannot operate buttons or tabs in 2D

- **Defect:** the global Space handler skips only inputs, textareas, selects and contenteditable. On a focused button, tab or summary, it calls `preventDefault` and starts pan.
- **Repro:** press Tab to move to 顯示家具物件, then press Space. Nothing changes.
- **Location:** `FloorPlanEditor.jsx:228`.
- **Fix:** Space starts pan only when focus is not on a control that Space operates: button, link, summary, or an element with a button, tab, checkbox, switch, radio, menu item or option role, or a focusable separator. Verified in headless Chrome:
    - Space on the focused 顯示尺寸 toggle switches it (aria-pressed true → false).
    - Space on the focused 地板材質 rail tab opens that panel.
    - Space + drag with no focused control still pans the 2D canvas.

### M4. Subtotals do not match the shown quantity (was H5)

- **Defect:** the quantity cell shows `toFixed(2)`, but subtotals and totals use the full value. The calculation is not wrong, but what the user sees does not add up.
- **Repro:** with seed rooms, waste 5% and price 333, dining shows 7.38 m² × 333 = 2,457.54, but the subtotal is **2,459.07**. The total can also differ from the two shown subtotals by 0.01.
- **Location:** `CostEstimate.jsx:18`, `:12`, `:25`.
- **Decision (2026-10-01):** calculate from the shown quantity (rounded to 2 decimals). Round each row subtotal to 2 decimals. Each total is the sum of those rounded subtotals, so every total reconciles with the rows shown.
- **Fix:** flooring quantity is rounded to 2 decimals when the row is built. Each row subtotal is rounded to integer cents, and the section subtotals and the total are sums of those cents. Verified in headless Chrome, with 333 on every flooring row and 0.335, 99.99, 1234.565, 0.01 and 7.777 on five furniture rows:
    - Every row: shown quantity × price = shown subtotal. Dining is now 7.38 m² × 333 = 2,457.54.
    - 家具小計 1,342.69 and 地板小計 30,426.21 each equal the sum of their rows.
    - 已填項目合計 31,768.90 equals the two subtotals.

## Low findings

These are small errors, edge cases or polish. Each line gives the cause and the repro.

- **L1. Wall height resets.** `FloorPlan3D.jsx:8`: the height is local state and is not stored. Set 2.8 m, switch to 2D and back: it is 0.9 m again.
- **L2. Esc and layer lock do not stop a 3D drag.** `three/viewer.js:150`: `cancelGesture` handles only the 2D drag. A locked drop leaves the model out of sync with the document.
    - **Fix (2026-10-02):** the 3D viewer has `cancelDrag()`. It runs on Escape, on window blur, and from `sync` when the furniture layer is locked or hidden, or the dragged item is gone. It moves the model back to its start, ends the gesture, and saves nothing. Verified in headless Chrome on 瓦斯爐: a plain drag moves it (control); Escape during the drag and a lock during the drag leave the saved position at [300, 6200]. The 3D image after Escape and after the lock matches a no-drag baseline (0.62% changed pixels in all three, from the session itself), so the model went back to its start.
- **L3. Status bar covers the 3D hint (probably wrong).** `src/style.css:5`, `:9`: `.canvas-content` sets `bottom:36px`, so the 3D hint sits above the status bar. Do not change it without a browser repro.
- **L4. Unchanged number field adds an undo step.** `FloorPlanEditor.jsx:263`: the field shows 3 decimals but compares with full precision. Focus X on a snapped 45° item, then Tab out: it moves a little.
    - **Fix (2026-10-06):** on blur, a value equal to the shown value is treated as no change. The full saved value stays, and no undo step is added. The L19 fix makes new snapped positions short, but old saved plans and typed values can still have more decimals than the field shows. Repro before the fix in headless Chrome: 書桌 saved as X 9500.000000001002, Y 6069.999999999, 寬度 1000.0001, 深度 600.00004; focus and blur with no edit changed all 4 values to the shown value and enabled 復原. After the fix, in mm and in cm: all 5 fields (blur, and Enter on 寬度) keep the saved value and 復原 stays disabled; a real 寬度 edit still saves 1200 and enables 復原. The L5 test still passes. No page errors.
- **L5. Number fields ignore Enter.** `FloorPlanEditor.jsx:263`: they commit only on blur. Name fields commit on Enter.
    - **Fix (2026-10-06):** Enter blurs the field, so the existing blur check commits the value. Enter during IME composition is ignored, the same as the room-name field. Repro before the fix in headless Chrome: 書桌 寬度 1200 → type 1300 + Enter → saved width stays 1200 and focus stays in the field. After the fix: saved width 1300 and focus leaves the field; a composing Enter on 深度 changes nothing; an empty value + Enter restores the old value. No page errors.
- **L6. Autosave misses tab close; no sync between tabs.** `FloorPlanEditor.jsx:106`: a 400 ms delay with no `pagehide` save. With two tabs, the last tab to save wins without a warning.
- **L7. Save errors hidden while measuring; some errors in English.** `FloorPlanEditor.jsx:256`, `:110`, `:28`: the measure hint replaces the status. "Save failed" and "Could not load saved plan" are English in a zh-TW UI.
- **L8. Measuring works while the dimensions layer is hidden.** `FloorPlanEditor.jsx:73`: only the lock is checked. The new measurement is not visible.
- **L9. Furniture on a shared room edge counts in two rooms.** `roomGeometry.js:12`: `containsPoint` is true on the boundary. A centre at (4820, 7000) is in both dining and living. No seed item is on an edge.
- **L12. Short hex colour rejected.** `FurnitureAppearance.jsx:3`, `:10`: `#abc` and `ff0000` revert, but other code accepts `#rgb`.
- **L14. Cost dock arrow key does nothing on first press.** `CostDock.jsx:13`: it changes the unclamped stored height. Saved 2000 in an 800 px window: the first ArrowDown has no visible effect.
- **L15. No recovery after WebGL context restore.** `three/viewer.js:146`: there is no `webglcontextrestored` handler, so the error overlay stays. 3D error text is also English.
- **L16. Lintels and sill heights hard-coded.** `three/models.js:696`, `:740`: two lintels use fixed coordinates, and sill height comes from the window's list index. A different plan puts them in the wrong place. The `bearing` option is stored but not used.
- **L17. Export file name is always `open-plan.json`.** `FloorPlanEditor.jsx:254`: the project name is ignored.
- **L18. Price field Enter has no IME check.** `CostEstimate.jsx:6`: other inputs check `isComposing`. Plausible only, because number inputs rarely open an IME.
- **L19. Snapped positions can save float noise.** Found on 2026-10-02 during M2 testing: a 3D drag saved `cx` = 1789.9999999999998. The snapping math does not round its final result.
    - **Cause:** `wallSnapping.js:6` calculates the rotated half-size with `cos` and `sin`. At 90° and 270° `cos` is not exactly 0, so an 800 × 420 item gets a half-size of `210.00000000000003`.
    - **Fix (2026-10-06):** `snapFurniture` rounds its final position to **0.1 mm**, in one place, so 2D and 3D drags both get it. Whole-mm rounding was rejected: an odd size (seed 飄窗墊 is 520 × 1575) is flush only at a half millimetre, and typed angles such as 45° give irrational flush positions. Verified in node: 1,622,400 snap calls (rotations 0/90/180/270/45/30, odd and even sizes) give no value with more than one decimal, and every wall snap is within 0.05 mm of the wall face. Verified in headless Chrome: a 90° item dragged to the wall at x = 0 saves `cx` = 210, where the old code gives 210.00000000000003. No page errors.

## Design decisions

These are not confirmed defects. Each needs a rule before any change.

- **L10. Doors in demolished walls.** `Measurements.jsx:7`, `:12`: walls are filtered from snapping, but openings and hinges are not. Openings are independent objects with no link to a wall. Decide what demolition does to the doors and windows in that wall. Proximity alone is not a sufficient rule.
- **L11. Flooring area ignores demolished walls.** `CostEstimate.jsx:11`: room polygons do not change. Removing [4580,0,4820,2400] adds 0.576 m² that is not counted. This is a known, documented limitation. Track it as a geometry enhancement.
- **L13. Net area and purchase quantity are not labelled apart.** `RoomProperties.jsx:11`: the panel shows net area with 1 decimal (7.0 m²). The estimate shows purchase quantity with 2 decimals and includes waste. Different precision is not a bug. Label the two values clearly as net area and purchase quantity (incl. waste).

## No issue found within the reviewed cases

No defect was found in these areas for the cases reviewed. This is not full verification. Do not change them without reason when you fix the findings above.

- **Undo and redo:** 50-step cap, redo clears on commit. Keyboard undo is blocked during a gesture, but **toolbar undo and history restore have no such guard** (`undo()` at `FloorPlanEditor.jsx:125`, `onRestore` at `:257`).
- **Keyboard shortcuts:** skipped while typing and during IME composition. Delete, Escape and M work as designed. The keydown handler reads current state each render. This does not cover H1, which is a stale document snapshot in the drag state.
- **Selection cleanup:** furniture selection clears when its layer is hidden or locked. **No general check confirms that the selected ID still exists after undo or history restore.** The toolbar actions do not crash, because they look up the item first.
- **Pointer capture:** released on pointerup, pointercancel and Escape, in 2D and for touch.
- **Touch navigation:** pinch and two-finger pan cancel a single-finger gesture and restore the doc.
- **Viewport:** wheel zoom is clamped. 1:60, 1:100 and fit work. Scale is kept when panels resize.
- **Furniture snapping:** rotated bounds are correct, demolished walls are skipped, tolerance follows zoom, equal-spacing math is correct.
- **Measurement tool:** click-click and drag modes, Shift axis lock, 20 mm minimum.
- **Room math:** area, perimeter (in metres) and point-in-polygon. Seed rooms do not overlap.
- **Cost logic:** waste applies only to flooring, bay windows are excluded, prices of 0 are valid, deleted furniture is not totalled.
- **2D↔3D coordinates:** mm→m, plan y→+Z and rotation sign agree. 3D drag uses the same snapping and goes through undo.
- **3D resource cleanup:** geometry, materials, textures, renderer, listeners, ResizeObserver and the animation loop are released on unmount.
- **Workspace preferences:** every `localStorage` access is in try/catch, and bad tab or theme values fall back to defaults. Exception handling does not make all values valid: the cost dock accepts an oversized stored height (see L14).
- **Loading:** legacy-name localization and geometry migration change only exact matches.

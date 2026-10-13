## From an image to a plan

- Units are millimetres. x goes right and y goes down, the same as in the image.
- Use one known dimension from the drawing (a dimension line or a written length) to set the scale. Report which dimension you used.
- Give each wall as the centre line of the wall (`a` and `b`) and its `thickness`. Walls must be horizontal or vertical.
- Tell walls, low walls and cabinets apart. Use the hatching, the line weight and the height labels of the drawing. Walls and partitions are `e` (exterior), `b` (bearing) or `n` (partition). A low wall, for example a balcony parapet or a half-height wall, is `low`. Cabinets, wardrobes and other built-in furniture are not walls: leave them out. Report each boundary that you are not sure about.
- A column (a filled block, frequently where walls meet) is a short bearing wall (`b`): its length and its `thickness` are the 2 sides of the block, as large as the image shows them. Do not make it as thin as the walls beside it. If a side is more than 1000 mm, make that side the length. If the block is more than 1000 mm on both sides, or has an L shape, use 2 or more bearing walls side by side that fill the block, and report it: their edges touch, they do not overlap, and each `thickness` stays from 20 to 1000. A room outline goes around the column, not through it.
- Draw one continuous wall through doors and windows. Do not split a wall at an opening.
- Add an opening only where the image shows one: a gap in the wall, a door arc or a window symbol. Do not add a door because a room has no visible entrance; report that room instead.
- Give each door, window, sliding door and empty opening its `wallId`, its `offset` from the wall's `a` end and its `width`.
- For each door, give `hinge` (`start` or `end`) and `swing` (`left` or `right` of the direction from `a` to `b`), as the image shows them.
- Use the heights that the drawing gives. A window label often gives its sill and head height, or its height and the height above the floor; a window that starts near the floor (to a balcony, for example) has a low `sill`. Leave a height out only when the drawing does not give it; then the default is used. Report the heights that you could not read.
- Give each room a polygon on the inside face of its walls.
- Do not add furniture.
- If a part of the image is not clear, give your best guess and report it as uncertain. Do not put notes in the JSON.
- If the plan has diagonal walls, say so and approximate them with horizontal and vertical walls.

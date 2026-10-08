## From an image to a plan

- Units are millimetres. x goes right and y goes down, the same as in the image.
- Use one known dimension from the drawing (a dimension line or a written length) to set the scale. Report which dimension you used.
- Give each wall as the centre line of the wall (`a` and `b`) and its `thickness`. Walls must be horizontal or vertical.
- Draw one continuous wall through doors and windows. Do not split a wall at an opening.
- Give each door, window, sliding door and empty opening its `wallId`, its `offset` from the wall's `a` end and its `width`.
- For each door, give `hinge` (`start` or `end`) and `swing` (`left` or `right` of the direction from `a` to `b`), as the image shows them.
- Give each room a polygon on the inside face of its walls.
- Do not add furniture.
- If a part of the image is not clear, give your best guess and report it as uncertain. Do not put notes in the JSON.
- If the plan has diagonal walls, say so and approximate them with horizontal and vertical walls.

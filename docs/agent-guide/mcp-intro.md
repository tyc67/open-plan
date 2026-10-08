# Open Plan agent guide

Open Plan is a floor-plan editor with a 2D plan and a 3D view. A plan is one JSON file (the Open Plan format, schema version 2). This guide tells an AI agent how to make a plan from a floor-plan image, and how to check, draw and change a plan file with the Open Plan MCP tools.

The plan file is the source of truth. The user can open it in the editor; the editor shows each change to the file at once, and the user's edits in the editor are saved to the same file. So read the revision again before you send a change.

**The full guide** (the plan format and the commands) is given by the tool `get_guide`, the resource `open-plan://guide` and the prompt `convert_floor_plan_image`.

## Work loop

1. Write or change the plan: a new plan from the image with `write_plan` (see "From an image to a plan"), or a batch of commands with `apply_commands`.
2. Run `validate_plan` and correct every error. Each error has the `path` of the field and a `code`.
3. Run `render_preview` and compare the image with the source image. Correct the differences, then go back to step 2.
4. Report to the user: the dimension that you used to set the scale, and each part of the plan that you are not sure about.

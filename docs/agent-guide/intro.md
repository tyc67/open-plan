# Open Plan agent guide

Open Plan is a floor-plan editor with a 2D plan and a 3D view. A plan is one JSON file (the Open Plan format, schema version 2). This guide tells an AI agent how to make a plan from a floor-plan image, and how to check, draw and change a plan file with the Open Plan command-line tool (CLI).

**`<cli>` in this guide** is the command that starts the Open Plan CLI on this computer. Replace it with that command each time, for example `node /path/to/open-plan/dist/cli.js` or the package command that the user gives you. Run `<cli> --help` to see that it works.

The plan file is the source of truth. The user can open it in the editor with `<cli> serve plan.json`; the editor shows each change to the file at once, and the user's edits in the editor are saved to the same file.

## Work loop

1. Write or change the plan: a new file from the image (see "From an image to a plan"), or commands with `<cli> apply`.
2. Run `<cli> validate plan.json` and correct every error. Each error has the `path` of the field and a `code`.
3. Run `<cli> render plan.json plan.png` and compare the PNG with the source image. Correct the differences, then go back to step 2.
4. Report to the user: the dimension that you used to set the scale, and each part of the plan that you are not sure about.

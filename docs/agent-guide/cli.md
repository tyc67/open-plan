## CLI commands

Add `--json` to any command for one JSON object on standard output. Each result has `ok`. When `ok` is `false`, it has a `code` and a `message`, and for validation problems an `errors` list.

| Command | What it does |
| --- | --- |
| `<cli> guide` | Prints this guide. |
| `<cli> schema` | Prints the JSON Schema and the field description of the format. |
| `<cli> new plan.json [--sample] [--replace]` | Writes an empty plan, or the sample apartment. An existing file is refused unless `--replace`; then it is backed up first. |
| `<cli> validate plan.json` | Checks the plan with the strict rules: an issue that the editor only warns about is an error here. Gives the `revision`. |
| `<cli> info plan.json` | Counts, size, rooms with areas, the `revision`, and warnings. |
| `<cli> apply plan.json commands.json` | Changes the plan with a batch of commands (see "Commands"). |
| `<cli> render plan.json out.png` | Draws the plan in 2D as a PNG. Options: `--crop x0,y0,x1,y1` (an area in mm), `--width px` (default 1200), `--grid` (a 1 m grid), `--dimensions`, `--no-text`. |
| `<cli> migrate old.json plan.json [--replace]` | Converts a schema version 1 file to version 2, with a report. |
| `<cli> backups plan.json` | Lists the backups of the plan. |
| `<cli> restore plan.json <backup-name>` | Restores a backup. The current file is backed up first. |
| `<cli> serve plan.json` | Opens the plan in the editor for the user (see below). |

**Exit codes:** 0 success; 1 validation errors, refused commands or a refused file; 2 incorrect usage; 3 `REVISION_CONFLICT`; 4 the plan is locked; 5 a file or backup error.

**Revision:** the `revision` is the SHA-256 of the raw bytes of the plan file, as 64 hex characters. Any change to the bytes changes it, also a change of formatting. `validate`, `info` and `render` give it.

**Backups:** each command that writes the plan (`apply`, `new --replace`, `migrate --replace`, `restore`) first copies the current file to the folder `plan.json.backups` next to it. The 20 newest backups are kept. If a backup cannot be written, the command writes nothing. `apply` writes nothing, and makes no backup, when the commands do not change the plan.

**Lock:** while a command writes, the file `plan.json.lock` exists, and other writers wait. Do not remove it unless an error tells you to.

**`serve`:** `<cli> serve plan.json` starts the editor for the user on `http://127.0.0.1:5190` (or the next free port) and prints a link with a secret token; do not share it. It runs until Ctrl+C. The editor shows each change to the file at once, also changes from `apply`. The user's edits in the editor are saved to the file, so read the revision again before you send commands. Start it only when the user asks; it keeps running.

**Editing the file directly:** you can write the plan file yourself (for the first version from an image). Then run `validate`. For changes to an existing plan, use `apply`: it checks the revision, so it does not write over a change that the user made in the editor.

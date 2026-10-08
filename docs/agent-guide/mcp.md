## MCP tools

The tools work on plan files in the **workspace**: the folder that the server was started for. A `path` is relative to the workspace; an absolute path must be inside it. A path outside it, also through a symlink, is refused with `PATH_OUTSIDE_WORKSPACE`.

| Tool | What it does |
| --- | --- |
| `get_guide` | Gives this guide. |
| `get_schema` | Gives the JSON Schema and the field description of the format. |
| `read_plan` `{ path }` | Gives the file's JSON as it is in the file (not changed), its `schemaVersion` and its `revision`. |
| `plan_info` `{ path }` | Counts, size, rooms with areas, the `revision`, and warnings. |
| `validate_plan` `{ path }` or `{ plan }` | Checks a plan file or an inline plan with the strict rules: an issue that the editor only warns about is an error here. Give exactly one of `path` and `plan`. A file gives its `revision`; an inline plan has none. |
| `render_preview` `{ path, crop?, width?, grid?, dimensions?, text? }` | Draws the plan in 2D and gives a PNG image. `crop` is `[x0, y0, x1, y1]`, an area in mm (the values can be negative); `width` is 1 to 2000 px (default 1200); `grid` adds a 1 m grid; `dimensions` adds the dimension chains; `text: false` leaves out all text. The image is at most 2000 px high and 4 million px. |
| `create_plan` `{ path, sample? }` | Writes an empty plan, or the sample apartment with `sample: true`. An existing file is refused (`DESTINATION_EXISTS`). |
| `write_plan` `{ path, plan, expectedRevision? }` | Writes a whole plan, after the strict check. For a new file, give no `expectedRevision` (without it, an existing file is refused with `DESTINATION_EXISTS`). To replace a file, `expectedRevision` is required; the file is backed up first. |
| `apply_commands` `{ path, expectedRevision, commands }` | Changes the plan with a batch of commands (see "Commands"). The file is backed up first. |
| `migrate_plan` `{ source, destination, expectedRevision? }` | Converts a schema version 1 file to version 2, with a report. For a new destination, give no `expectedRevision`. To replace a file (also `source` itself), give its `expectedRevision`; it is backed up first. |

**Results:** each result is one JSON object, as structured content and as the same JSON text. It has `ok`. When `ok` is `false`, the tool result is an error, and the object has a `code` and a `message`, and for validation problems an `errors` list. `render_preview` also gives the image.

**Revision:** the `revision` is the SHA-256 of the raw bytes of the plan file, as 64 hex characters. Any change to the bytes changes it, also a change of formatting. `read_plan`, `plan_info`, `validate_plan` (for a file) and `render_preview` give it. If you give an `expectedRevision` and the file no longer exists (it was deleted after you read it), the result is `REVISION_CONFLICT` with `currentRevision: null`, and nothing is created.

**Backups:** a tool that replaces a plan file first copies the current file to the folder `plan.json.backups` next to it. The 20 newest backups are kept. If a backup cannot be written, nothing is written. A new file has no previous file, so it has no backup. A write that does not change the plan writes nothing, and the revision stays the same.

**Limits:** a plan file or an inline plan is at most 5,242,880 bytes; a batch is at most 1000 commands and 1,048,576 bytes. Larger input is refused with `INPUT_TOO_LARGE`.

**The workspace limit:** the server refuses paths outside the workspace and symlinks that point out of it. It cannot stop another program that replaces a folder in the path at the same moment as a call.

**Write the plan with the tools:** use `write_plan` for the first version from an image, and `apply_commands` for changes. Both check the revision, so they do not write over a change that the user made in the editor.

### Sending a batch

`apply_commands` takes the plan path, the revision and the commands:

```json
{
  "path": "plan.json",
  "expectedRevision": "<the revision from read_plan, plan_info or validate_plan>",
  "commands": [
    { "op": "set_plan_name", "name": "My apartment" },
    { "op": "add_furniture", "type": "sofa", "name": "Sofa", "cx": 2000, "cy": 1500, "w": 2000, "d": 900 }
  ]
}
```

### A refused batch

This batch puts a door where the window `win1` is:

```json
[{ "op": "add_opening", "type": "door", "wallId": "w1", "offset": 600, "width": 900, "hinge": "start", "swing": "left" }]
```

`apply_commands` writes nothing and gives an error result with this object:

```json
{"ok":false,"code":"COMMANDS_REFUSED","message":"The commands were refused; the plan was not changed.","errors":[{"commandIndex":0,"path":"commands[0].offset","code":"openings-overlap","params":{"op":"add_opening","openingId":"door","otherId":"win1"}}],"notices":[]}
```

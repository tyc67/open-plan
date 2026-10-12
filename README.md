# Open Plan

A local floor-plan editor (2D and 3D) that works on plan data, and a set of tools for AI agents that make and change plan files.

- **For a person:** give a floor-plan image to your own AI agent, let the agent write Open Plan JSON, import the file, then correct the scale and the geometry in the editor.
- **For an agent:** a command line tool and a local MCP server validate, draw and change a plan file, and the editor in the browser shows the same file live.

Status on 2026-10-11: Steps A to D of [`docs/plan-import-roadmap.md`](docs/plan-import-roadmap.md) are closed; Steps C and D have accepted exceptions, recorded there. **The product stays local (the owner's decision, 2026-10-11); no public release is recorded:** this repository has no remote, the CLI package is private, and the names of the packages are not decided. Step E (a remote MCP server) is not started.

## Run

```sh
pnpm install
pnpm dev          # the editor, website mode: the plan is stored in this browser
```

`pnpm build` builds the core, the web app and the CLI. `pnpm preview` serves the built web app.

To work on a plan **file** (the editor saves each finished edit to the file automatically, and shows changes that an agent makes to it; writes stop while there is a conflict or an error that needs your decision):

```sh
pnpm --filter open-plan-cli build
node packages/cli/dist/cli.js new plan.json --sample
node packages/cli/dist/cli.js serve plan.json
```

`node packages/cli/dist/cli.js --help` lists all commands: `guide`, `schema`, `validate`, `info`, `new`, `migrate`, `apply`, `render`, `serve`, `mcp`, `backups`, `restore`.

## What the editor does

- **Plans from data:** an empty plan, the sample apartment, or an imported JSON file. An import is checked first; errors show with the path of the field, so you can paste them to your agent. The open plan is backed up before it is replaced.
- **2D and 3D:** the same plan in an SVG drawing and in a Three.js view. Walls are centre lines with a thickness; doors, windows, sliding doors and holes belong to a wall. Only horizontal and vertical walls are supported.
- **Scale correction:** measure a known length, type its real value, and the plan is scaled.
- **Editing:** walls (type, thickness, length, split, join, reverse, demolition mark, add, delete), openings (type, position, width, heights, hinge and swing, move to another wall, add, delete), rooms (outline points, name, floor material, add, delete), furniture, measurements, a cost estimate, undo and redo, and a history of the session.
- **Storage:** website mode keeps one plan in the browser; file mode (`serve`) keeps the plan in a file on your computer, with backups beside it. Export and import move a plan between the modes.

The user interface is in Traditional Chinese (zh-TW).

## For agents

- The guide: `node packages/cli/dist/cli.js guide` (forms: `text`, `agents-md`, `skill`, `llms`, `mcp`). Its sources are in `docs/agent-guide/`; ready-made files are in `examples/agents/`.
- The format: [`docs/plan-format.md`](docs/plan-format.md) and [`docs/open-plan.schema.json`](docs/open-plan.schema.json).
- The MCP server: `node packages/cli/dist/cli.js mcp --root <folder>` (stdio; 10 tools; it works only on files in the root folder. This boundary protects against mistakes and existing links, not against a hostile local process that changes a folder in the path at the same moment as a call; the roadmap records this limit in C5).
- Tested agents: Claude Code and Codex (2026-10-08, non-interactive runs; records in `docs/agent-exercises/`). Gemini CLI, Cursor and OpenCode are not tested.

A plan that passes `validate` has a correct format. It is not proof that the plan agrees with the image: compare the drawing with the source.

## Layout

- `apps/web/`: the editor (Vite + React, JavaScript). `src/floorplan/` has the editor, the 2D drawing, the 3D view (`three/`) and the storage; `src/workspace/` has the workspace shell (panels, toolbar, import dialog).
- `packages/core/`: TypeScript. The plan types, the validator, the migration from the old format, geometry, the editing commands and the 2D SVG drawing. The web app and the CLI use only its public exports.
- `packages/cli/`: TypeScript. The CLI, `serve` (live file mode) and the MCP server. Its build includes the built editor.
- `docs/`: the roadmap, the plan format and schema, the agent guide, the records of the agent exercises, and an old defect review ([`docs/feature-review.md`](docs/feature-review.md), from 2026-10-06, with a state note from 2026-10-11).
- `tools/checks/`: browser checks (headless Chrome through `playwright-core`). `tools/visual/`: screenshot capture and exact pixel compare; output goes to `tools/visual/out/`, which is not committed.
- `examples/agents/`: instruction files for agents.

## Tests

```sh
pnpm test         # Vitest: core, CLI and web logic (the first step builds the CLI and the web app)
pnpm typecheck    # the core and the CLI; the web app is JavaScript and has no typecheck
```

The browser checks need Google Chrome (set `CHROME_PATH` for another location). Build the CLI first.

```sh
# against the built `serve`
for c in serve mcp-serve scale walls openings-edit rooms-edit edit-gestures; do node tools/checks/$c.mjs; done

# against a web server
pnpm --filter open-plan-web exec vite preview --port 4319 --strictPort &
for c in session demolition replace import validation openings bounds; do node tools/checks/$c.mjs http://localhost:4319/; done
```

Screenshots: `node tools/visual/capture.mjs <url> <out-dir>`, then `node tools/visual/compare.mjs <baseline-dir> <out-dir>`. The baselines are kept outside the repository.

## Origin and licences

The project started from the Mamezu codebase (workspace shell, panels, toolbar) and from a single-file apartment reference (`floorplan-3d`). `donor/mamezu/` and `reference/` are local copies that Git does not track. **The source attribution and the third-party notices of the donor are only in `donor/mamezu/`, in local copies. Check them, and add a licence and the notices to the repository, before any redistribution.** The CLI build writes the notices of its bundled npm packages to `packages/cli/dist/THIRD-PARTY-NOTICES.txt`.

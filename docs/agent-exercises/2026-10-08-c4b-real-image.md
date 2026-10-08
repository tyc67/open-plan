# C4b: real-image exercise (2026-10-08)

Two agents, each in a fresh session, made an Open Plan file from one real floor-plan image, using the supplied agent guide, the image and the installed CLI (not fully isolated: see the correction below) (roadmap C4b, Step B "Real image"). This record holds no image and no plan file; it gives their full SHA-256 values. The image, both plans, the run logs, the packed CLI, the guide, the prompt and the website screenshots are kept locally, outside the repository, in `~/Documents/open-plan-agent-exercises/2026-10-08-c4b/`.

## Inputs

- **Image:** a published interior-design floor plan with the mark of 沐月室內裝修設計工程有限公司 (mumoon), JPEG, 800 × 619 px, SHA-256 `cc440c23f1775451825db9bbc53de6013733cca194e6d0939b0eb7019415991d`. The user supplied it for this test. **License: MIT-licensed, confirmed by the user (2026-10-08);** no license file or source link was given. The image and the plans made from it are kept outside the repository with the other exercise files.
- **CLI:** the packed package (`open-plan-cli-0.1.0.tgz`, SHA-256 `688fe3cd7b693b47fa644b133b538eb6d699a4369055e245505df9b65f438c4b`, from commit `29975b4`), installed with npm in each folder; Node 24.21.0, macOS arm64.
- **Guide:** `open-plan guide --cli "./node_modules/.bin/open-plan"`, saved as `GUIDE.md` (SHA-256 `34eda67f4913fe8b66aca3b8c50dc4dfc2708693ce955aaddd1058711dab8401`), the same in both folders.
- **Prompt** (the same for both; SHA-256 `f5cd3f70a80d76d3c4d3ec58a8a6b4952670fa731f0d4038b9fed5c2558f516d`):

  > Read GUIDE.md in this folder. Make an Open Plan plan file, plan.json, in this folder from the floor-plan image floorplan.jpg. Follow the work loop in the guide: write the plan, run validate and correct every error, render the plan and compare the PNG with the image, and correct the differences. Use the CLI command that the guide gives. Work only in this folder. At the end, report the dimension that you used to set the scale, and each part of the plan that you are not sure about.

- **Isolation:** two separate folders outside the repository, with only `GUIDE.md`, `floorplan.jpg` and the installed CLI. Neither run could see the other's folder by instruction, and neither folder had an `AGENTS.md` or `CLAUDE.md`. Global instructions outside the folders: see the correction below.

## Agents

| | Claude Code | Codex |
| --- | --- | --- |
| Version | Claude Code 2.1.285 | codex-cli 0.160.0 |
| Model | `claude-opus-5-5` | `gpt-6.1-sol`, reasoning effort low (from the user's config) |
| Command | `claude -p "$(cat prompt.txt)" --setting-sources project,local --permission-mode acceptEdits --allowedTools "Bash Read Write Edit Glob Grep" --output-format stream-json --verbose` | `codex exec -C <folder> --skip-git-repo-check -s workspace-write -i floorplan.jpg --json "$(cat prompt.txt)"` |
| Global instructions | **Likely loaded** (corrected after C5c preparation, see below) | No `AGENTS.md` (`~/.codex` has none); the config also enables a plugin (`neon-postgres`), and the `apps` feature was on (corrected, see below) |
| Image | Read from the folder with its file tool | Attached with `-i`, and also in the folder |
| Run | 29 turns, 543 s, US$1.85 | 12 shell commands; 489 k input tokens (458 k cached), 5.1 k output |

**Correction (2026-10-08, C5c preparation).** This record first said that `--setting-sources project,local` left out the global `~/.claude/CLAUDE.md` ("tested before the run"). C5c preparation reproduced global instruction loading with the same Claude Code version and flags: asked to quote its instruction files, the session quoted `~/.claude/CLAUDE.md` (the user's instructions to write in ASD-STE100 Simplified Technical English and to read `CONTEXT.md` files). C4b's earlier claim that those flags disabled it was unsupported. The original C4b log does not establish whether the file was loaded (its init event does not list instruction files), so the Claude Code run is **likely affected**. For Codex, the record said that the config sets only the model; it also enables the `neon-postgres` plugin, and the `apps` feature was on, so tools from them may have been available (its log shows only 12 shell commands and 4 messages, no tool from either). **What stays:** the valid plans, the imports, the rendering and the geometry results. **What changes:** the claim that each agent worked only from the guide and the image; the exercise was not fully isolated.

## What each agent did

**Claude Code.** It read the guide, cut zoomed crops of the image, measured walls in pixels, and wrote a generator script that made `plan.json`. `validate` found one error (`opening-outside-wall`: the living-room window was 4 mm longer than its wall); it shortened the window, validated again (valid), rendered, compared, and deleted its scratch files. It did not use `apply`: it wrote the whole file each time, as the guide allows for a first version.

- **Scale:** the master-bedroom window label "窗寬307" (307 cm) over about 134 px, so 22.9 mm per px; three other labels (312, 236, 162 cm) agree within about 1 %.
- **Result:** revision `f5590e01aa2379258618975732fcc94b6521f67dc8250701a3435e82868521bc`; 43 walls, 19 openings, 12 rooms; 14.88 × 13.58 m with the balconies.
- **Uncertain parts that it reported (12):** wall thicknesses; columns drawn as pairs of bearing walls (the format has no column type); unreadable sill and head labels; a window drawn with a swing arc; the entry door (one 1250 mm leaf, or a door with a side leaf); the study reached only through a sliding door from the master bedroom; the master lobby; the vanity alcove; two hatched walls that may be cabinet backs; small bathroom doors; balcony railings as low walls; one open room for living, dining, kitchen and entry.

**Codex.** It read the guide, enlarged the image and a detail, printed the schema, and wrote `plan.json` with a script (scale 23.4 mm per px). `validate` passed. After a render it found missing columns and a room polygon that overlapped the study, and corrected them with `apply`: the first batch was written; the next one was refused (`wall-end-off-line` on `move_wall_end`), it changed the batch, and the second try was written. It validated and rendered after each batch, and deleted its scripts and command files at the end (the two backups in `plan.json.backups`, kept with the record files, have the earlier versions).

- **Scale:** the upper-middle window label read as "234" (2340 mm) over about 100 px; it reported the reading as uncertain.
- **Result:** revision `1a17397b42caf038a253f4b8d90203e0ca24a65d23c62df195e770dafe517db2`; 44 walls, 21 openings, 14 rooms; 15.08 × 13.84 m with the balconies.
- **Uncertain parts that it reported (5):** the scale label, wall thicknesses and columns, study and kitchen boundaries (walls or cabinets), small-room access and bathroom door hinges, window types and balcony boundaries.

## Checks

- **CLI:** both final files pass `validate` (strict) with no errors and no warnings.
- **Website import:** each file was imported with 匯入 in the website build (the strict import policy): the dialog accepted both (Claude: 43 walls, 19 openings, 12 rooms; Codex: 44, 21, 14), the plan replaced the open plan, and the 2D and 3D views drew with no page error.
- **Live view:** each file was also opened with `serve` (without a browser of its own) and the links were given to the user for review; the plan files did not change (same revisions as at the end of each run).

### Geometry against the image

Window widths against the labels that can be read in the image:

| Label (cm) | Claude Code (mm) | Codex (mm) |
| --- | --- | --- |
| 312 (living room to the north balcony) | 3110 | 3253 (as a sliding door) |
| 162 | 1620 | 1638 |
| 236 | 2360 | 2340 |
| 307 (master bedroom) | 3070 | 3112 |
| 214 | 2140 | 2153 |

- **Claude Code:** widths within 1 % of the labels; sills read from the labels (about 50 mm for the full-height windows). The layout matches the image: the open living, dining, kitchen and entry area as one room; the study, the master bedroom with its lobby, bedroom 2, two bathrooms, three balconies with low railing walls, and four columns. Approximations: the two free-standing hatched walls in the living area may be cabinet backs; the study door (a guessed sliding door from the master bedroom); the entry door as one leaf.
- **Codex:** widths within about 4 % (its scale is about 2 % larger). The layout is recognisable, with the same rooms and balconies. Errors: the wall behind the sofa is real (Claude Code drew it too), but Codex put two openings in it (1427 and 889 mm) that the image does not show, and made the area on its east side a separate room, "Study / circulation" (18.7 m²), although the image shows one open living area; all 11 balcony edges are exterior walls (`e`), not low walls; a short extra wall stands between the study corner and bedroom 2; every window has the default sill 900 and head 2400, although the labels give about 50 mm for the full-height windows to the balconies; the window and cabinet strip on the west wall of the living room is missing.
- **Both:** furniture and built-in cabinets are left out, as the guide says.

**Wall overlay (pixel masks).** Each plan was drawn with `render --no-text` at the agent's own scale (mm per image pixel) and fitted onto the image by position and a scale adjustment. The fitted adjustment was × 0.996 for both: a **0.4 % fitted alignment adjustment** of each agent's own image-to-plan mapping. It does not measure absolute scale, because each mapping came from that agent's own reading of the image; the scale accuracy is the dimension-label table above.

The image mask is the image pixels with luminance below 130, after one erosion (thin lines drop out), without the logo, the title line and the north arrow. The plan mask is the render pixels with luminance below 175 and a channel spread below 40. These are **pixel-mask proximities, not coverage of real walls**: the plan mask leaves out low walls (drawn light grey) and includes door arcs; the image mask includes some symbols and leaves out walls drawn as thin double lines.

| | Claude Code | Codex |
| --- | --- | --- |
| Image-mask pixel coverage (image-mask pixels with a plan-mask pixel within 2 px) | 96.8 % | 95.5 % |
| Plan-mask pixels within 2 px of an image-mask pixel | 64.6 % | 59.5 % |

In the overlay pictures, Claude Code's walls lie on the image walls almost everywhere; Codex's misses are the balcony edges (as full walls), the extra wall near bedroom 2 and the openings in the sofa wall. The script (`overlay/overlay-fit.mjs`, with every threshold), its inputs (the PNG of the image, the two renders and their crops) and the overlay pictures are kept with the record files; it gives the same figures when run again.

**Human check: not done.** On 2026-10-08 the user closed the Step B image item without a separate visual review. The findings in this record come from the checks above (CLI, website import, label table and overlay), not from a human review.

**Image license:** MIT-licensed, confirmed by the user.

## Findings for the guide and the format

Findings 1, 3 and 4 are resolved by the C4 follow-up (see the roadmap); 2 and 5 stay open.

1. **Sill and head labels:** Codex used the default heights although the image gives them. The guide could say: when the drawing gives a sill or head height, use it.
2. **Columns:** both agents drew structural columns as thick walls, because the format has no column type. This works in 2D and 3D; a column type is a possible later format change, not needed now.
3. **Walls, low walls or cabinets:** both agents were unsure whether some hatched lines are walls or cabinet backs. The guide could say: tell structural walls and partitions, low walls (for example balcony parapets, type `low`) and cabinets apart, using the drawing's hatching and height labels; leave out cabinets; and report each boundary that stays uncertain.
4. **Negative crop values:** `render --crop -360,-523,…` is refused, because the option parser reads a value that starts with `-` as an option; `--crop=-360,-523,…` works. Found while checking this exercise. Resolved: the CLI now joins a negative value to `--crop`, so both forms work.
5. **Working files:** both agents deleted their scripts. Codex's `apply` batches are known only from its log; this does not affect the plan, but a record of the batches would help a review.

## Result

- **C4b:** the CLI workflow is accepted: two agents, using the supplied guide, image and installed CLI, made a plan that passes `validate`, imports in the website, and draws in 2D and 3D (Claude Code likely also had the user's global `CLAUDE.md`, see the correction). In this exercise, Claude Code's result was better: its plan matches the image closely, and Codex's plan has the errors listed above. The two runs used different models and reasoning settings, so this is not a general ranking of the agents.
- **Step B "Real image": closed** by the user's decision (2026-10-08), without a separate human review. The image license is confirmed.
- **Not covered:** the C5 MCP exercise (these runs used the CLI); Gemini CLI, Cursor and OpenCode.

# Open Plan agent guide: copyable forms

These files are for **your own project**, not for this repository. Each one is the full Open Plan agent guide (roadmap C4) in one form. Do not edit them here: they are generated from `docs/agent-guide/` and `docs/plan-format.md`, and a test checks that they are up to date (`pnpm --filter open-plan-cli build && pnpm --filter open-plan-cli guide:write` writes them again).

| File | For | How to use it |
| --- | --- | --- |
| `AGENTS.md` | Codex, Cursor, OpenCode, and Gemini CLI when it is set to read `AGENTS.md` (it reads `GEMINI.md` by default) | Copy the section into the `AGENTS.md` of your project. |
| `claude-code/skills/open-plan/SKILL.md` | Claude Code | Copy the `open-plan` folder to `.claude/skills/` in your project, or to `~/.claude/skills/` for all projects. |
| `apps/web/public/llms.txt` (in this repository) | Tools that read `llms.txt` | The website serves it at `/llms.txt`. |

The installed CLI prints the same text: `<cli> guide --form agents-md`, `<cli> guide --form skill` or `<cli> guide --form llms`; `<cli> guide` prints the guide alone.

**`<cli>`:** the package name is not final, so the guide writes `<cli>` for the command that starts the Open Plan CLI. An agent replaces it with the command on its computer. To print the guide with your command in place of `<cli>`, add `--cli "<your command>"`, for example `<cli> guide --form skill --cli "node ~/open-plan/packages/cli/dist/cli.js"`.

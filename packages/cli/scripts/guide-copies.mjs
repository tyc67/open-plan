// The committed copies of the agent guide (roadmap C4), relative to the repository root, and the form of each.
// `pnpm --filter open-plan-cli guide:write` writes them from the built CLI; a test checks that they are up to date.
export const GUIDE_COPIES = [
  { form: 'agents-md', path: 'examples/agents/AGENTS.md' },
  { form: 'skill', path: 'examples/agents/claude-code/skills/open-plan/SKILL.md' },
  { form: 'llms', path: 'apps/web/public/llms.txt' },
];

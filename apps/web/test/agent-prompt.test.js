import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AGENT_PROMPT } from '../src/floorplan/agentPrompt.js';

// Roadmap C4: the website prompt (for chat agents) and the agent guide (for agents with the CLI) share the image
// instructions and the format description, so the two cannot give an agent different rules.
const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').trim();

describe('website agent prompt', () => {
  it('has the shared image instructions and the whole format description', () => {
    expect(AGENT_PROMPT).toContain(read('docs/agent-guide/image-to-plan.md'));
    expect(AGENT_PROMPT).toContain(read('docs/plan-format.md'));
  });
  it('asks for one JSON code block, and for the scale and the uncertain parts outside the JSON', () => {
    expect(AGENT_PROMPT).toMatch(/^Convert the attached floor-plan image to Open Plan JSON, schemaVersion 2\./);
    expect(AGENT_PROMPT).toContain('reply with the JSON in one code block');
    expect(AGENT_PROMPT).toContain('Put the scale that you used and the uncertain parts in your reply, not in the JSON.');
  });
});

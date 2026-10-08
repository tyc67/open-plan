import formatDoc from '../../../../docs/plan-format.md?raw';
import imageToPlan from '../../../../docs/agent-guide/image-to-plan.md?raw';

// The prompt that the user copies to an AI agent with a floor-plan image (roadmap B3). The image instructions are the
// same fragment as in the agent guide (roadmap C4), and the published format description follows, so the agent has the
// exact fields; those files are the one source for the website and the CLI.
const OPENING = 'Convert the attached floor-plan image to Open Plan JSON, schemaVersion 2. Follow the format below exactly, and reply with the JSON in one code block. Put the scale that you used and the uncertain parts in your reply, not in the JSON.';
const CLOSING = 'If Open Plan shows errors when I import your JSON, I will paste them to you; each error ends with the path of the field, for example (openings[2].width).';

export const AGENT_PROMPT = `${OPENING}\n\n${imageToPlan.trim()}\n\n${CLOSING}\n\n---\n\n${formatDoc.trim()}\n`;

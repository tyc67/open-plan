// The local MCP server (roadmap C5), started by an agent with `open-plan mcp [--root <folder>]` over standard input
// and output. stdout carries only MCP messages; diagnostics go to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema,
  McpError, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import packageText from '../package.json?raw';
import { guideText, mcpInstructions } from './guide.js';
import { createTools, type ToolOutput } from './mcp-tools.js';
import { Workspace } from './workspace.js';

const GUIDE_URI = 'open-plan://guide';
const PROMPT = 'convert_floor_plan_image';

export async function runMcpServer(root: string): Promise<void> {
  const workspace = await Workspace.open(root);
  const tools = createTools(workspace);
  const server = new Server(
    { name: 'open-plan', title: 'Open Plan', version: JSON.parse(packageText).version },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: mcpInstructions() },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.list }));
  const reply = ({ result, png }: ToolOutput) => ({
    content: png ? [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text' as const, text: JSON.stringify(result) }] : [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: !result.ok,
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (!tools.has(request.params.name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool ${request.params.name}.`);
    return reply(await tools.call(request.params.name, request.params.arguments ?? {}));
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: GUIDE_URI, name: 'guide', title: 'Open Plan agent guide', description: 'The full guide: the work loop, the image rules, the plan format, the tools and the commands.', mimeType: 'text/markdown' }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== GUIDE_URI) throw new McpError(ErrorCode.InvalidParams, `Unknown resource ${request.params.uri}.`);
    return { contents: [{ uri: GUIDE_URI, mimeType: 'text/markdown', text: guideText('mcp') }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{
      name: PROMPT, title: 'Convert a floor-plan image', description: 'Make an Open Plan file from a floor-plan image, with the full guide.',
      arguments: [{ name: 'path', description: 'The plan file to write, relative to the workspace (default plan.json).', required: false }],
    }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    if (request.params.name !== PROMPT) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt ${request.params.name}.`);
    const path = request.params.arguments?.path || 'plan.json';
    const task = `Make an Open Plan plan file, ${path}, from the floor-plan image that I give you. Follow the work loop of the guide below: write the plan with write_plan, run validate_plan and correct every error, draw it with render_preview and compare it with the image, and correct the differences. At the end, report the dimension that you used to set the scale, and each part of the plan that you are not sure about.`;
    return { description: 'Make an Open Plan file from a floor-plan image.', messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `${task}\n\n${guideText('mcp')}` } }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The SDK's request parsing drops an own "__proto__" argument key, so the tool would never see it. Such a call is
  // answered here, from the arguments as they came from JSON, with the tool's own argument check (USAGE). Nothing is
  // kept for later, so a malformed request leaves no state behind.
  const receive = transport.onmessage!;
  transport.onmessage = message => {
    const m = message as { id?: string | number; method?: string; params?: { name?: unknown; arguments?: unknown } };
    const args = m.params?.arguments, name = m.params?.name;
    if (m.method === 'tools/call' && m.id !== undefined && typeof name === 'string' && tools.has(name) && args && typeof args === 'object' && Object.hasOwn(args, '__proto__')) {
      const id = m.id;
      // The client can disconnect before the reply: report it on stderr, not as an unhandled rejection.
      tools.call(name, args as Record<string, unknown>).then(output => transport.send({ jsonrpc: '2.0', id, result: reply(output) }))
        .catch(error => process.stderr.write(`Cannot send the reply to request ${id}: ${(error as Error)?.message ?? error}\n`));
      return;
    }
    receive(message);
  };
}

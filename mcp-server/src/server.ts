#!/usr/bin/env bun
/**
 * Kevin MCP Server — entrypoint.
 * stdio transport; spawned by Claude Code on plugin enable.
 *
 * Boot is side-effect-free. Tools that write (compile state, OAuth tokens,
 * playwright captures) create their parent dirs at write time. Pre-init
 * plugins must not touch disk.
 */
import { log } from '@/shared/log';
import type { ToolDef } from '@/shared/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOL_MODULES } from './tools/modules';

// Tool modules load from the shared TOOL_MODULES list so registration and
// the dashboard's capability listing can never drift. A broken module still
// fails the boot — Promise.all rejects before the server connects.
const TOOLS: ToolDef[] = (
  await Promise.all(TOOL_MODULES.map(async (name): Promise<{ tools: ToolDef[] }> => import(`./tools/${name}`)))
).flatMap((mod) => mod.tools);

const server = new McpServer({ name: 'kevin', version: '0.1.0' });

for (const tool of TOOLS) {
  const toolLog = log.with(() => `tool:${tool.name}`);
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) => {
    toolLog.debug('dispatch', args);
    try {
      const result = await tool.handler(args);
      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLog.error(`failed: ${message}`);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });
}

await server.connect(new StdioServerTransport());
log.info(`kevin MCP server started — tools=${TOOLS.length}`);

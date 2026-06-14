/**
 * browser-flows MCP tool — runs any flow in `skills/browser-flows/flows/<flow>/index.ts` from
 * inside the MCP server process. The server is spawned by Claude Code (not the Bash-tool seatbelt),
 * so the headed browser a flow opens isn't blocked by the sandbox that stops `bun run` from a Bash
 * call. Generic + portable: it discovers flows by listing the folder and passes `params` through as
 * `--key value`. Flows themselves are agent-specific.
 */

import { FOLDERS } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';

const FLOWS_DIR = resolve(FOLDERS.ROOT, 'skills', 'browser-flows', 'flows');
const MAX_OUTPUT_CHARS = 8_000;

const listFlows = (): string[] =>
  existsSync(FLOWS_DIR)
    ? readdirSync(FLOWS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(resolve(FLOWS_DIR, entry.name, 'index.ts')))
        .map((entry) => entry.name)
    : [];

const toFlags = (params: Record<string, string | number | boolean>): string[] =>
  Object.entries(params).flatMap(([key, value]) => {
    if (value === false) {
      return [];
    }
    return value === true ? [`--${key}`] : [`--${key}`, String(value)];
  });

const tail = (text: string, limit: number): string =>
  text.length <= limit ? text : `…(${text.length - limit} chars trimmed)\n${text.slice(-limit)}`;

// A flow's `index.md` is its guidance — injected into the result each run so the flow can give
// the agent direction (e.g. "read these source files to navigate the site").
const readGuidance = (flow: string): string => {
  const guidancePath = resolve(FLOWS_DIR, flow, 'index.md');
  return existsSync(guidancePath) ? readFileSync(guidancePath, 'utf8').trim() : '';
};

export const tools: ToolDef[] = [
  defineTool({
    name: 'browser_flows',
    description:
      'Run a browser-flows flow that drives a site in a VISIBLE browser (the operator can log in manually when a flow needs it — no API keys). Runs inside the MCP server so the headed browser launches outside the Bash sandbox. flow = a folder under skills/browser-flows/flows/ with an index.ts (e.g. hacker-news). params map to --key value. Long-running for interactive flows. Screenshots land in reports/captures/browser/<env>/<flow>/<run>/.',
    inputSchema: {
      flow: z.string().describe('Flow name — a folder under skills/browser-flows/flows/ (e.g. "hacker-news")'),
      params: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .default({})
        .describe('Flow args, mapped to --key value (e.g. { env: "web", count: 10 })')
    },
    handler: async ({ flow, params }) => {
      if (!/^[a-z0-9-]+$/.test(flow)) {
        throw new Error(`Invalid flow name "${flow}". Use lowercase letters, digits, and hyphens.`);
      }
      const scriptPath = resolve(FLOWS_DIR, flow, 'index.ts');
      const rel = relative(FLOWS_DIR, scriptPath);
      if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(scriptPath)) {
        return { error: `Flow "${flow}" not found. Available: ${listFlows().join(', ') || '(none)'}` };
      }

      const nodeModules = resolve(FOLDERS.ROOT, 'mcp-server', 'node_modules');
      const proc = Bun.spawn(['bun', 'run', scriptPath, ...toFlags(params)], {
        cwd: FOLDERS.ROOT,
        env: { ...process.env, NODE_PATH: nodeModules, PLAYWRIGHT_BROWSERS_PATH: '0', KEVIN_HOME: FOLDERS.HOME },
        stdout: 'pipe',
        stderr: 'pipe'
      });

      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;

      return {
        flow,
        exitCode,
        guidance: readGuidance(flow),
        output: tail(`${stdout}${stderr}`.trim(), MAX_OUTPUT_CHARS)
      };
    }
  })
];

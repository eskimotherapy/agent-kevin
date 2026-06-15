/**
 * setup_worktree — MCP wrapper around the shared `setupWorktree` (see @/worktree/setup).
 *
 * The MCP server runs outside the Bash command sandbox, so `git worktree add` here can write
 * the main repo's `.git/config` and the checked-out config files (`.vscode/settings.json`,
 * `.mcp.json`) that the seatbelt denies when git runs under the Bash tool. The skill decides
 * WHICH repo (it knows the operator's layout) and passes the main checkout path; this tool
 * does the mechanical create + bootstrap. The same logic backs the `kevin worktree` CLI.
 */
import { defineTool, type ToolDef } from '@/shared/types';
import { setupWorktree } from '@/worktree/setup';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'setup_worktree',
    description:
      'Create a sibling git worktree and bootstrap it (copy gitignored local files → install deps → build), running outside the Bash sandbox so git can write .git/config and checked-out config files. Pin the repo first, then pass the absolute path to its MAIN checkout. Returns the worktree path, branch, copied files, and per-step output. Read-only against the source checkout.',
    inputSchema: {
      repoPath: z
        .string()
        .describe('Absolute path to the MAIN checkout of the repo the worktree is for (the skill resolves which repo).'),
      branch: z
        .string()
        .describe('Branch name. A bare name (no "/") is namespaced under the operator (e.g. "basem/my-thing"); a name containing "/" is used verbatim. Created with -b; if it already exists, it is checked out instead.'),
      baseBranch: z
        .string()
        .optional()
        .describe('Explicit branch/ref to start the new branch from (e.g. "main"). Overrides auto-detection (dev → develop → main → master → current HEAD). Must resolve in the repo.'),
      slug: z
        .string()
        .optional()
        .describe('Folder suffix for the worktree dir (<repo>-<slug>). Defaults to the branch\'s last path segment.'),
      extraInstalls: z
        .array(z.string())
        .optional()
        .describe('Relative subdirs with their own lockfile to `install` after the main bootstrap (e.g. ["packages/standalone-cli"]). Must be relative, no "..".')
    },
    handler: async (args) => setupWorktree(args)
  })
];

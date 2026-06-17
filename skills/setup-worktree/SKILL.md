---
name: setup-worktree
description: Create a git worktree for parallel agent work and bootstrap it so it's ready to code — copies the gitignored local files (`.env*`, `.claude/settings.local.json`, `.cursor`, `.cmux`) from the main checkout, installs dependencies, and builds the packages. Use whenever the user asks to spin up a worktree, work on a branch in parallel, set up an isolated checkout for another agent, or "make a worktree for <feature>". First pins down WHICH repo the worktree is for (the user's words, the `$KEVIN_CODE_PATH` default when they assume you know, or by asking when neither resolves), then creates the worktree as a sibling of that repo, never nested inside it, and offers to add it to a sibling `*.code-workspace` if one exists.
allowed-tools: mcp__plugin_agent-kevin_kevin__setup_worktree, Bash, Read, Edit
---

# setup-worktree — parallel checkout, ready to code

Stand up a [git worktree](https://git-scm.com/docs/git-worktree) so a second agent can work a
branch in parallel without touching the main checkout's files. Pin the repo, then hand the create
+ bootstrap to the `setup_worktree` MCP tool in one call.

**Why the tool, not raw `git worktree add` in Bash:** the Bash command sandbox denies the writes
`git worktree add` must make — it rewrites the main repo's `.git/config` and checks out tracked
config files (`.vscode/settings.json`, `.mcp.json`). The MCP server runs *outside* that sandbox
(like `browser_flows`), so the tool gets those writes through.

## Step 0 — pin the target repo

The worktree is always of one specific repo. A HOME can sit above several repos, so figure out
which one before doing anything:

1. **The user named it** ("a worktree for acme-mono", "for the agent repo", "of this repo") —
   use that repo. An explicit name always wins over the default below.
2. **The user assumes you know the repo + `$KEVIN_CODE_PATH` is set** ("make me a worktree for
   the dark-mode work", no repo named) — use `$KEVIN_CODE_PATH` as the default repo. That env var
   is the operator's primary codebase (captured at init), so it's the repo they mean when they
   don't say which. State which repo you picked so a wrong default gets caught before the cleanup.
3. **Otherwise, ask. Always.** This covers an unset/empty `$KEVIN_CODE_PATH`. Do not infer the
   repo from cwd. The agent HOME is itself almost always a git repo (it versions `knowledge/` and
   `projects/`), so cwd being inside a git repo does NOT make it the intended code repo. List the
   candidate code repos (e.g. the git repos under `tech/`) and let the user pick. The wrong repo
   is an annoying cleanup.

Resolve the chosen repo to the **absolute path of its main checkout**. (If you're standing in a
worktree of it, the tool still resolves the real main checkout from `git worktree list` — but pass
the main checkout when you can, to keep paths predictable.)

## Step 1 — create + bootstrap via the tool

Call `mcp__plugin_agent-kevin_kevin__setup_worktree` with:

- `repoPath` — absolute path to the repo's main checkout (from Step 0).
- `branch` — a short, descriptive branch name from what the user is doing; ask only if genuinely
  ambiguous. **Do not add a type prefix** (`feat/`, `chore/`, `test/`); the operator's name is the
  branch folder. The name is always namespaced under the operator (e.g. `my-thing` →
  `basem/my-thing`, derived from git identity); a name already under that namespace is kept as-is.
  An existing branch is checked out as-is.
- `baseBranch` (optional) — explicit branch/ref to start the new branch from. Defaults to the first
  of `dev` → `develop` → `main` → `master` that exists locally, falling back to the main checkout's
  current branch.
- `slug` (optional) — folder suffix for the worktree dir. Defaults to the branch's last path
  segment, producing `<repo>-<slug>` as a **sibling** of the main checkout (never nested).
- `extraInstalls` (optional) — relative subdirs with their own lockfile that need a separate
  install (e.g. `["packages/standalone-cli"]`).

The tool creates the sibling worktree, copies the gitignored locals (every `.env`/`.env.*`, every
`.claude/settings.local.json`, every `.cmux`, plus root `.cursor`/`.cursorignore`), detects the
package manager, installs, and runs the first build script it finds (`build` → `build:packages` →
`build:libs`). It returns `{ worktreePath, branch, branchExists, baseBranch, copied,
packageManager, built, extraInstalled, steps }`.

**Check `steps` for any `ok: false`** (each carries a tail of the command output) before you call
the setup a success.

## Step 2 — offer to add it to the VS Code workspace

If the target repo has a VS Code workspace file alongside it (a `*.code-workspace` in the repo's
parent dir, the sibling level where the worktree was just created), the operator likely keeps all
their checkouts open in one window. Offer to add the new worktree to it:

1. Glob the parent dir (`dirname(repoPath)`) for `*.code-workspace`. None found: skip this step,
   no need to mention it.
2. One or more found: ask the operator whether you should add the new worktree folder to it (name
   the file). Only proceed on a yes.
3. On yes, `Read` the workspace file and `Edit` a new entry into its `folders` array pointing at
   the worktree. Paths in `folders` are relative to the workspace file's own location, so use the
   worktree dir's basename (it's a sibling of the file). Match the existing entries' shape (a bare
   `{ "path": "..." }`, plus a `"name"` if the others carry one). Leave every other key
   (`settings`, `extensions`, the existing folders) untouched.

This is a plain JSON edit, not the MCP tool's job: do it with `Read` + `Edit`.

## Step 3 — confirm and hand off

Report the `worktreePath`, `branch`, and the `baseBranch` it branched from, surface any failed
`steps`, then point the next agent (or a cmux workspace) at it. When the branch lands, clean up
with `git worktree remove <worktreePath>`.

## Notes

- The main checkout must already have its `.env*` files in place — that's the copy source.
- The tool is **create-only**: it refuses if the worktree dir already exists. To rebuild an
  existing worktree, remove it (`git worktree remove <path>`) and recreate.
- Repos without a `package.json` just get the file copy; install/build no-op.
- Outside Claude Code, the same logic is on the CLI: `kevin worktree <repoPath> --branch=...
  [--slug=...] [--extra=sub1,sub2]`. That path is for a real terminal — under the Bash sandbox the
  MCP tool is the only way (the CLI would hit the same `.git/config` write block).

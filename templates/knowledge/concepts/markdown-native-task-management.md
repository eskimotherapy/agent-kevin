---
title: Markdown-Native Task Management
sources: [seeded by /agent-kevin:init]
created: {{INIT_DATE}}
updated: {{INIT_DATE}}
---

# Markdown-Native Task Management

A file-per-task architecture using YAML frontmatter and markdown bodies as a queryable task database, with Obsidian (or any markdown editor) as the UI layer, git as the audit trail, and a TypeScript module as the enforcement layer. This is the pattern your agent uses for every task across every project.

## Core Pattern

Each task is an individual markdown file: machine-readable frontmatter (status, priority, assignee, dependencies) + human-readable body (description, checklist, conversation thread). Files live inside project folders (`projects/<name>/tasks/<id>-<slug>.md`), browsable in Obsidian and queryable by code.

```
projects/
  <project-a>/tasks/aa-001-first-task.md
  <project-b>/tasks/bb-001-another-task.md
```

No database. No API server. The filesystem *is* the database. Git provides full audit history for free.

## Architectural Decisions

### File-per-task, not file-per-project

One task = one file. Alternatives considered:

- **Single `tasks.md` per project:** threads bloat the file, diffs become noisy, concurrent edits conflict.
- **Database (SQLite, JSON):** loses markdown renderability, requires tooling for every read.

File-per-task scales cleanly — hundreds of files across many projects is trivial for both the filesystem and the editor.

### Programmatic module, not prompt-based skill

The task module is TypeScript code (the MCP server's `task_*` tools), not a Claude skill. This is a deliberate choice:

| Concern | TypeScript Module | Prompt-Based Skill |
|---------|-------------------|--------------------|
| Schema enforcement | Code-guaranteed | Relies on the LLM writing valid YAML |
| ID generation | Atomic, deterministic | LLM scans folder, hopes for no race |
| Status transitions | Validated programmatically | Relies on prompt-following |
| Composability | Any tool/CLI/skill can call it | Only LLM sessions use it |
| Testability | Unit tests | None |

**Principle: enforce, don't instruct.** When data integrity matters, put the rules in code that fails loudly, not in prompts that fail silently.

### Surgical mutations, never round-trip

Task and frontmatter updates patch the frontmatter block in place and leave the body byte-for-byte identical. Full reparse → re-serialize loops silently corrupt files when edge cases (multi-line YAML arrays, sub-headers in description sections) don't roundtrip cleanly. The body is **only** parsed for reads (scans, queries), never for writes.

### Round-trip verification on every mutation

After every write, the module re-reads the file and asserts each requested field equals the persisted value. Mismatch raises an error and the operation fails loudly. The cost is one extra small-file read; the catch surface is silent FS rejection (sandbox deny), frontmatter parse failures, hallucinated tool invocations whose "success" was just optimistic narration, and concurrent-writer races.

**General principle:** for any persistent mutation where the call's return value is divorced from filesystem state — sandboxed writes, MCP-mediated writes, any tool boundary that can return success without the syscall succeeding — pair the write with a re-read assertion. Treat the file as the source of truth, not the function return.

### Append-only threads with callout types

Task conversations use Obsidian callouts (`[!quote]`, `[!info]`, `[!warning]`) as a structured, append-only log. Three rules:

1. **Never edit or delete previous entries** — the thread is a historical record.
2. **Callout type signals source:** `[!quote]` = human, `[!info]` = agent, `[!warning]` = automated system action.
3. **Parseable by regex** — no custom parser needed.

This renders natively in Obsidian as color-coded collapsible boxes. No plugins required.

### Auto-increment IDs over timestamps

Task IDs use project prefix + sequential number: `aa-003`, `bb-001`. Short IDs are better for conversational reference ("about aa-002") than long timestamps. The agent assigns IDs, solving the coordination problem.

### Minimum viable task

A task requires only title + project. The agent infers everything else: `status: open`, `priority: P2`, empty labels/deps/blockers. This lowers task-creation friction to near zero.

### Recurring work excluded

Tasks are discrete, completable items. Recurring operational work (scans, compiles, checks) lives in scheduled hooks or skills, not tasks. Mixing the two creates zombie tasks that are never "done."

### Due dates are hard deadlines

If `due:` is set, it's a real deadline. Miss it and the agent flags it as overdue. Aspirational dates use priority instead. Binary semantics keeps overdue notifications meaningful.

## Status Lifecycle

Five states with programmatic auto-transitions:

```
open → active → done
  |       |
  |       +→ blocked → active (auto-unblock)
  |       |
  |       +→ cancelled
  |
  +→ cancelled
```

**Auto-transitions** applied during scans:
- **Auto-block:** unresolved `depends_on` or non-empty `blocked_by` → `blocked`
- **Auto-unblock:** all deps done + no external blocker → `active`
- **Auto-close:** all checklist items checked → `done`

Invalid transitions are enforced by the module — you can't go from `blocked` to `done` without unblocking first.

**Auto-transitions are invariants, not procedures.** A subtle hazard: writing auto-block logic against the "typical" path (open → active → blocked) misses tasks where the blocking condition is already true at creation. The rule "unresolved deps → blocked" is a state invariant checked against every non-terminal status, not a procedural step attached to one transition.

## Obsidian as UI

Open the home directory as an Obsidian vault — no agent internals visible. Task rendering uses only core features:

- **Properties panel:** visual YAML frontmatter editor with date pickers and tag chips.
- **Checkbox toggling:** click to check/uncheck in the Checklist section.
- **Callout rendering:** thread entries display as styled, colored boxes.
- **Bases** (core plugin): interactive dashboard with inline editing, filtering, grouping.

No community plugins required.

## Human Edit Safety

The agent never overwrites human edits to Description or Checklist sections. It only *appends* to Thread, never edits existing entries. When a user modifies frontmatter or checks items in Obsidian, the task module respects the change on next scan. Two writers, non-overlapping domains.

## See Also

- [[concepts/karpathy-wiki]] — same surgical-mutation pattern applied to the wiki itself
- [[concepts/audit-premise-decay]] — why stale `status:` fields need periodic reconciliation

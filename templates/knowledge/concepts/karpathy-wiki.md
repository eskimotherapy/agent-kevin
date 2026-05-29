---
title: Karpathy Wiki Pattern
sources: [seeded by /agent-kevin:init]
created: {{INIT_DATE}}
updated: {{INIT_DATE}}
---

# Karpathy Wiki Pattern

LLM-maintained knowledge base architecture inspired by [Andrej Karpathy's approach](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) and [Cole Medin's implementation](https://github.com/coleam00/claude-memory-compiler). This is the pattern behind your agent's entire memory system — understand this one article and the rest of the wiki makes sense.

## Core Idea

Raw inputs (conversations, notes, documents) are "source code." An LLM "compiler" processes them into structured, cross-linked knowledge articles — the "executable." You don't manually organize your knowledge. You have conversations, and the LLM handles synthesis.

## Three-Layer Architecture

- **Raw layer** (`knowledge/raw/`): immutable inputs
  - `sessions/YYYY-MM-DD.md` — conversation transcripts captured by hooks (no LLM in extraction)
  - `inbox/` — anything you drop in for compile to absorb (notes, articles, snippets)
  - `user/feedback.md` — append-only correction + reaction log
  - `archive/` — compiled inbox items land here
- **Compiled layer** (`knowledge/`): the LLM-maintained wiki
  - `user/` — long-form facets of who the user is (profile, skills, preferences, career, interests)
  - `concepts/` — cross-cutting patterns that span ≥2 projects (this folder)
  - `memory/` — hot context (active threads, recent decisions, learnings) plus transient daily memory
  - `index.md` — master catalog; every permanent article gets listed here with a one-line description
- **Automation** (plugin: `agent-kevin/`)
  - `SessionEnd` hook captures the session transcript to `raw/sessions/`
  - `/agent-kevin:knowledge-compile` synthesizes raw → wiki via the Agent SDK
  - `knowledge_lint` MCP tool runs structural health checks

Three operations: **capture** (hooks extract session turns), **compile** (raw → wiki), **lint** (health checks + repair).

## Why It Works

- No database, no embeddings — just markdown files browsable in any editor (Obsidian, VS Code, vim)
- At wiki scale (~50–200 articles), LLM judgment over a structured index outperforms vector search
- Every session compounds — the compiler reads existing articles and folds new information in
- Portable: any LLM with file access + a `CLAUDE.md`/`AGENTS.md` operating manual can run this pattern

## Operating Principles

**Concepts are the connections.** Profile articles describe entities; concept articles describe patterns linking them. Remove the concepts layer and the wiki collapses to isolated profiles with no synthesis. The bar for a concept article: spans ≥2 projects or recurs across ≥2 sessions.

**Hooks do I/O only.** Background LLM synthesis from detached processes is fragile (auth, context limits, partial failure). All synthesis happens in interactive compile sessions where the agent has full tooling. Hooks just capture and stage.

**Wikilinks for internal, markdown for external.** `[[concepts/audit-premise-decay]]` for in-wiki references. Regular markdown links (`[name](path)`) for things outside the wiki (project READMEs, external docs). Don't mix.

**Memory has two forms.** Permanent (user facets, concepts) grows indefinitely. Transient (`memory/`) has a rolling window — older entries get absorbed into permanent articles, daily files auto-prune. The `memory/index.md` is loaded every session and must stay tight.

**Compile is idempotent.** State tracking enables incremental compilation — only changed files reprocess. If the process dies mid-compile, the next run resumes from checkpoint state, not from scratch.

**Surgical mutations only.** Task and frontmatter updates never round-trip through a parser-serializer — they patch the frontmatter block and leave the body byte-for-byte identical. Full reparses silently corrupt files when edge cases (multi-line YAML arrays, sub-headers) don't roundtrip cleanly.

**Verify the actual sink.** When the compiler claims to have written something, the next session reads the destination. Pipelines that never re-verify at the destination produce silent drift between what the compiler thinks it wrote and what's actually on disk.

## When This Pattern Doesn't Fit

- If your knowledge is structured/queryable (CRM records, ticket data) — use a database, not markdown
- If you need sub-second retrieval over 10k+ documents — use a vector store
- If you don't have an LLM in the loop to synthesize — this is just a folder of notes

The pattern's power comes from the LLM as compiler. Without that, it's filesystem hygiene with extra steps.

## See Also

- [[concepts/self-evolution-loop]] — how the wiki improves itself via feedback
- [[concepts/markdown-native-task-management]] — the same pattern applied to task state
- [[concepts/audit-premise-decay]] — why the wiki needs periodic re-validation, not just appends

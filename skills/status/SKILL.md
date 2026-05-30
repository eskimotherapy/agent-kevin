---
name: status
description: Command-center overview of the whole agent — skills, MCP tools, hooks, knowledge wiki, compile coverage, tasks, context assembly (static @-imports + dynamic SessionStart), layered settings (secrets redacted), and logs. Use when you want a high-level "what is Kevin right now" snapshot.
disable-model-invocation: true
allowed-tools: Bash
---

# Status

A tabbed "mission control" overview rendered by the deterministic `kevin status`
command. Don't recompose or summarize it — the command already gathers and
formats the data.

> In a real terminal `kevin status` launches an **interactive** TUI (← → / 1-6
> switch tabs, q quits). Through Claude / piped, it auto-detects the non-TTY and
> renders a **static** single tab instead — so just run it and present the output.

## Run

Default to the **overview** tab:

```bash
bun "$CLAUDE_PLUGIN_ROOT/bin/kevin" status --color=always
```

Render a specific tab when the user asks to drill in:

```bash
bun "$CLAUDE_PLUGIN_ROOT/bin/kevin" status <tab> --color=always
# tabs: overview · context · knowledge · work · system · settings
```

- `work` — task load, per-project breakdown, overdue/active/stale lists
- `system` — full skills list, MCP servers/tools, hook wiring
- `context` — what loads each session: static `@-imports` + dynamic SessionStart manifest (session tail, today's reports, git activity)

Present the output **verbatim** inside a fenced code block so the banner, bars,
and alignment survive. If the output shows raw `\x1b[` escape sequences instead
of color (some renderers don't interpret ANSI), re-run with `--color=never` and
present that instead.

## Notes

- Pure read: the command only reads state, never mutates.
- Secrets are redacted at the source (`••••`); never un-redact them.
- `--no-banner` drops the ASCII banner on the overview tab.

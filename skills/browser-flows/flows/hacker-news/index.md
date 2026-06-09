# hacker-news flow — guidance

Injected into the `browser_flows` result each run. This is the **reference flow** — copy its shape to build your own.

## What it does

Visits the Hacker News front page, scrapes the top stories into a structured digest (rank, title, url, points, author, comments), and optionally opens the #1 discussion. No login — it just reads a public site.

```
browser_flows  flow=hacker-news  params={ count: 10 }
browser_flows  flow=hacker-news  params={ count: 5, open: true }
```

## Anatomy (copy this shape for a new flow)

A flow is a folder under `flows/` with:

- **`index.ts`** — the entry. Declares its `targets` and composes building blocks inside `runFlow(...)`.
- **`index.md`** — this guidance; injected into every result. Put navigation tips, gotchas, and source pointers here.
- **building-block modules** (here `stories.ts`) — small, named functions for each unit of work, so variants reuse the overlap.
- **`types.ts`** — shared shapes.
- **`assets/`** *(optional)* — files to upload (pass a path to your block).

`runFlow(targets, handler)` parses CLI args → `params`, picks `targets[params.env]` (defaults to `local`, or the only target if there's just one), launches a headed browser, waits for manual login **only if the target has an `auth` config**, runs your handler, and always closes the browser. Each `step(session, 'label', fn)` screenshots to `reports/captures/browser/<env>/<flow>/<run>/` (and a `*-FAILED.png` + aria dump on error) — so a changed page is obvious.

## Targets: no-auth vs auth

This flow's target has **no `auth`**, so it just visits a public URL:

```ts
const TARGETS = { web: { name: 'web', appUrl: 'https://news.ycombinator.com' } } satisfies Record<string, Target>;
```

For a flow that drives a site you log into, add `auth` and `runFlow` will pause for a manual login (your real session, persisted across runs — no API keys), then continue:

```ts
const TARGETS = {
  local: { name: 'local', appUrl: 'http://localhost:3000', auth: { loginPath: '/login', homePath: '/dashboard' } }
} satisfies Record<string, Target>;
```

## Notes

- The browser launches **inside the MCP server** (the `browser_flows` tool), not a Bash call — the macOS seatbelt blocks a headed browser spawned from Bash, but not the server.
- Extraction here uses `page.evaluate` for a clean one-shot scrape; for interaction prefer `getByRole`/`getByLabel`. HN's markup is stable — if it drifts, retune the selectors in `stories.ts`.
- Ideas to extend: a GitHub-trending digest, a docs-search-and-read flow, a "fill a form on a site you log into" flow — all the same shape, just different targets + blocks.

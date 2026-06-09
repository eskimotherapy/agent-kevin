# browser-flows

Drive a real website in a **visible browser** to run repeatable, end-to-end flows — scrape a page into structured data, fill a form, or click through a multi-step task. When a flow targets a site you log into, it uses your own session (no API keys); when it doesn't, it just visits public pages.

## What it is

A Claude Code skill that exposes one MCP tool, **`browser_flows`**, which runs a *flow* — a small TypeScript program that drives Playwright. Flows live one-folder-each under `flows/`. The skill is manual-invoke only (`/agent-kevin:browser-flows`); Kevin calls the tool with a flow name + params.

The reference flow is **`hacker-news`** — scrape the HN front page into a digest. Copy it to build your own.

## How it works

```
browser_flows (MCP tool, runs in the MCP server)
   └─ spawns: bun run flows/<flow>/index.ts --k v …
        └─ runFlow(targets, handler)        ← lib/flow.ts
             ├─ parse args → params
             ├─ pick targets[params.env]    (default: local, or the only target)
             ├─ launch headed persistent Chrome   ← lib/browser.ts
             ├─ ensureLoggedIn (manual login, only if the target has `auth`)
             ├─ run your handler  (compose building blocks; step() screenshots each)
             └─ close the browser
```

**Why a tool and not a Bash script:** a headed browser **can't launch from the Bash tool** — the macOS seatbelt blocks it (mach/WindowServer). The `kevin` MCP server is *not* under that seatbelt, so the tool spawns the flow from there and the window opens fine.

**Login is manual and persistent:** for a target with `auth`, the flow opens the site and waits for you to log in by hand (your real session — no API keys). The session is saved to a per-env profile in `.kevin/browser/`, so later runs skip the login. Public-site flows (like `hacker-news`) have no `auth` and skip the wait entirely.

## Using it

```
browser_flows  flow=hacker-news  params={ count: 10 }
browser_flows  flow=hacker-news  params={ count: 5, open: true }
```

- The Chrome window opens, the flow runs, and the tool returns the output tail.
- The flow's `index.md` is returned as `guidance` — its per-flow playbook.
- Screenshots (one per step, `*-FAILED.png` on error) land in `reports/captures/browser/<env>/<flow>/<run>/`.

## Creating a new flow

A flow is just a folder with an `index.ts`. **No tool edit and no restart** — the dispatcher discovers any `flows/<dir>/index.ts` at call time, and each run is spawned fresh from disk.

1. `mkdir flows/<name>/` and add `index.ts`:

   ```ts
   import { runFlow } from '../../lib/flow';
   import { type Target } from '../../lib/browser';

   const TARGETS = { web: { name: 'web', appUrl: 'https://example.com' } } satisfies Record<string, Target>;

   runFlow(TARGETS, async ({ params, target, session }) => {
     // compose building blocks from sibling ./*.ts modules; use step(session, 'label', fn)
   });
   ```

2. Put reusable, per-screen logic in sibling modules (e.g. `stories.ts`) and wrap each unit in `step(session, 'label', fn)` so it screenshots.
3. Add `index.md` — the guidance injected into every result (which selectors to retune, navigation tips). The highest-leverage file for maintenance.
4. Drop files to upload in `assets/` if a flow uploads.

Copy **`flows/hacker-news/`** as the reference — it shows the full shape (entry → a building-block module → structured output), a single no-auth target, params, and navigate → extract → interact.

### Targets: auth vs no-auth

- **With `auth`** (`{ loginPath, homePath }`): `runFlow` pauses for a manual login, then continues. Use for any site you sign into.
- **Without `auth`** (like `hacker-news`): it just visits a public URL — no login wait.

## Layout

| Portable | Per-flow |
|---|---|
| `lib/browser.ts` — launch, `ensureLoggedIn`, `step()`, `Target` | `flows/<flow>/index.ts` — entry + `targets` |
| `lib/flow.ts` — `runFlow` harness | `flows/<flow>/*.ts` — building blocks |
| `mcp-server/src/tools/browser-flows.ts` — dispatcher | `flows/<flow>/index.md` — guidance |
| `BROWSER` group in `mcp-server/src/config.ts` | `flows/<flow>/assets/` — uploads |

## Notes

- **Restart semantics:** adding/editing a flow or `lib/` needs no restart (spawned fresh per run). Changing the dispatcher tool (`tools/browser-flows.ts`) or `config.ts` requires restarting the session so the MCP server reloads.
- **Playwright:** Chromium is the plugin's own bundled install (`PLAYWRIGHT_BROWSERS_PATH=0`); no global setup. If it's missing, run `cd mcp-server && bun install`.
- **Selector tuning** is expected when a site changes — read the `*-FAILED.png` + the printed aria snapshot, fix the locator (prefer `getByRole`/`getByLabel`), re-run.

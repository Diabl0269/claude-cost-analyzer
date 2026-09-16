# Integration — running the whole thing

How the four modules (`core/parse`, `core/pricing`+`cost`+`db`, `server`, `web`) are wired
together, how to run them, and what each knob does. Written for whoever picks this up next.

## Node 22 is not optional

`node:sqlite` is the only database driver, and the index needs **FTS5** (with the trigram
tokenizer) for search. Homebrew's Node 23 ships a SQLite built without it, and every table
creation fails. `.nvmrc` pins 22, so:

```sh
nvm use            # Node 22.x
node -v            # v22.x
```

If you start the server on the wrong build, `core/db/schema.ts` probes FTS5 (it creates a
throwaway `fts5` table inside a transaction and rolls it back) and throws `SqliteFeatureError`;
`server/cli.ts` catches it and prints one line before exiting 1:

```
This Node build's SQLite has no FTS5. Use Node 22 LTS (nvm use — .nvmrc is set to 22).
```

## Production: one process

```sh
npm run build                       # tsc -p tsconfig.node.json && vite build
CCA_HOME=~/.claude-cost-analyzer node dist/server/cli.js --port 4141
# or: npm start
```

`server/index.ts` opens the SQLite store, loads `config.json`, starts the indexing worker, mounts
the Hono app on `127.0.0.1:<port>`, kicks off a rescan, and starts the filesystem watcher. The
built SPA is served from `dist/web` with an SPA fallback for any non-`/api` path.

CLI flags: `--port <n>`, `--no-open`, `--claude-dir <path>`, `--home <path>`, `--reindex`
(one-shot full rebuild, prints counts, exits without starting HTTP).

## Development: two processes

```sh
npm run dev        # scripts/dev.mjs
# → server on 127.0.0.1:4141 (CCA_DEV=1), vite on 127.0.0.1:5173 proxying /api
open http://127.0.0.1:5173/
```

`scripts/dev.mjs` runs the server as `node --watch --watch-preserve-output --import tsx/esm
server/cli.ts --no-open`, **not** `tsx watch`. The `tsx` CLI opens a unix domain socket to talk to
its child, which sandboxed shells refuse with `EPERM`; `tsx/esm` is the loader half only. The
indexing worker is spawned with the same loader (`execArgv: ['--import', 'tsx/esm']` in
`server/indexing.ts`) when the worker resolves to `worker.ts` rather than `worker.js`.

`CCA_DEV=1` adds `127.0.0.1:5173` / `localhost:5173` to the Host and Origin allow-lists, which is
what lets the browser on the Vite port talk to the API on 4141.

## Environment variables

| variable | default | what it does |
|---|---|---|
| `CCA_HOME` | `~/.claude-cost-analyzer` | where `index.sqlite` and `config.json` live (dir 0700, files 0600). `--home` overrides it. |
| `CCA_PORT` | `4141` | default port; `--port` overrides it. Also the port `vite.config.ts` proxies `/api` to. |
| `CCA_CLAUDE_DIR` | — | transcript root to index, overriding `settings.roots`. `--claude-dir` overrides both. |
| `CCA_DEV` | unset | `1` puts the server in dev mode: the Vite origin (port 5173) joins the Host/Origin allow-lists. |
| `CCA_DEV_ORIGINS` | unset | extra comma-separated dev origins, e.g. `http://127.0.0.1:5174,http://localhost:5174`, for a second dev server. Only read when `CCA_DEV=1`; entries that are not `http(s)` URLs on a loopback host **with an explicit port** are dropped, so a typo can never open the server to a routable address. |
| `CCA_ALLOW_UNAUTH_STATUS` | unset | `1` exempts `GET /api/status` from the session-cookie check. Used by `playwright.config.ts` to wait for the server before the browser has authenticated. Nothing else is ever exempt. |
| `CCA_EMBED_ORIGINS` | unset | Comma-separated loopback parent origins allowed to embed this app in an iframe, e.g. `http://127.0.0.1:3000,http://localhost:3000` for a local productivity dashboard on port 3000. Relaxes CSP `frame-ancestors` only; Host/Origin/CORS rules are unchanged. Unset keeps `frame-ancestors 'none'`. |

## Ports used by this repo

| port | what |
|---|---|
| 4141 | dev + `npm start` server |
| 5173 | Vite dev server (`strictPort`) |
| 4171 | Playwright's server (`playwright.config.ts`, `CCA_HOME=.cca-e2e-home`) |

## Indexing: who owns which connection

Three connections can be open on `index.sqlite` at once, and that shapes two of the contracts:

- **The store** (`core/db/store.ts`, main thread) holds one long-lived read connection.
- **The worker** (`server/worker.ts`, a `worker_threads` Worker) opens and closes its own
  connection per run. WAL mode lets it write while the store reads.
- **`scripts/validate-cost-state.ts`** opens both, one after the other.

Consequences:

1. **`Store.reopen()`.** A `full` rebuild drops and recreates every table from the worker's
   connection. The reader must start from a fresh handle afterwards, so `server/index.ts` passes
   `onRunComplete: (mode) => { if (mode === 'full') store.reopen(); }` to the `IndexManager`.
   Incremental and rescan runs only rewrite rows, so WAL visibility is enough and the reader is
   left alone. `tests/core/db/reopen.test.ts` covers the rebuild path.
2. **Pricing reaches the worker over `postMessage`.** Indexing needs `PricingConfig` for one
   thing — `charsPerToken`, which decides how many tokens an attributed item is estimated at — so
   `IndexManagerOptions.pricing` is a getter, read at the start of every run. A user who edits
   chars/token gets it applied on the next index without a restart. Everything else about money
   is computed at read time and needs no reindex at all.

## Scratch projects and the counts that disagree

Two of the numbers on screen are meant to differ, and both now say so:

- `GET /api/status` returns `counts.sessions` (a raw row count of everything indexed) plus an
  optional **`scratchSessions`** — how many of those the `hideScratchProjects` setting is keeping
  out of every list and total. It is only present while the setting is on.
  `StoreStatus.scratchSessions` is computed unconditionally inside `Store.status()` itself (one
  grouped scan over `sessions`, all-time, no second query), so `server/routes/status.ts` just reads
  `status.scratchSessions` off the same call it already made and includes it only when
  `ctx.settings.hideScratchProjects` is on. On the author's real data that is 477 indexed and 337
  hidden — a gap worth about $4, and worth explaining. The UI prints it in the index-status
  tooltip, in Settings › Data, and in the sessions footer (linking to the setting).
- The overview's session KPI counts sessions **with a request in the range** (`activeRange` in
  `core/db/filters.ts`), while `/api/sessions` lists sessions **by their start date** (`range`).
  A session that began before the window and kept running is in the first and not the second, so
  the KPI is labelled "Sessions with requests" and carries a tooltip.
- `GET /api/projects` has the same range split at the project level: `sessionCount` and
  `totalCost` per project cover only requests inside the resolved range (missing bounds → the last
  30 days, same as every analytics route), and the response echoes that window back as
  `ProjectsResponse.range`. Every project is still listed at zero when nothing fell in the window,
  so the rail never loses a navigation target. `firstActivity`/`lastActivity` stay all-time — they
  describe the project, not the window.

## Roots policy

`settings.roots` (the directories the indexer walks) is validated server-side on every
`PUT /api/settings` by `server/rootsPolicy.ts`'s `validateRoots(roots, ccaHome, previousRoots?)`,
because the zod schema in `core/settings.ts` only checks shape, not filesystem meaning. Two rules:
every root must resolve to a directory that exists right now (grandfathered for a root that was
already saved and has since disappeared, so an unrelated settings change like a theme toggle isn't
blocked by an unmounted drive), and no root may be, or contain as an ancestor, a fixed list of
system directories (`/etc`, `/var`, `/System`, `/Library`, `/root`, `/proc`, `/sys`, `/dev`) or
per-user credential locations (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.npmrc`,
`~/.netrc`, `~/.pypirc`, `~/.git-credentials`, `~/.claude` itself, and the app's own `CCA_HOME`) —
always enforced, no grandfather. `~/.claude/projects`, the documented default root, is explicitly
carved back out since it's a normal descendant of the denied `~/.claude`, not an ancestor of
anything sensitive. See `docs/dev/server.md` "Security model" for the full threat model.

## Request body limit

Every `/api/*` route sits behind `hono/body-limit` at 1 MiB (`MAX_API_BODY_BYTES` in
`server/app.ts`), applied after auth so an unauthenticated flood can't force large-body parsing.
Every real payload (the pricing table, settings, `POST /api/reindex {full}`) is a few KB; an
oversize body 413s (`{ error: { code: 'payload_too_large', ... } }`) before it is buffered or
`JSON.parse`d.

## What-if pricing

`RangeQuery.whatIf` (`fromKey>toKey,fromKey>toKey`) is a display-only price substitution. Routes
that take a range pass it through their query object. The four routes that do not have a range —
`GET /api/sessions/:id`, `/transcript`, `/agents`, and `GET /api/export/sessions/:id.json` — read
`?whatIf=` themselves and put it on `QueryContext.whatIf`; `resolverFor` in `core/db/store.ts`
resolves `q?.whatIf ?? ctx.whatIf`, so a query-level value still wins.

## Validation

`scripts/validate-cost-state.ts` (`npm run validate`) indexes the configured roots and compares
every session that has a `cost-state` line against Claude Code's own tally, per token class and
in USD, then classifies the gap. See `docs/dev/validation.md` for the method and the last run,
and `docs/METHODOLOGY.md` §2 for what each status means. It reuses `$CCA_HOME/index.sqlite`
(incremental by default), so pointing it at a running server's home costs a second:

```sh
CCA_HOME=$TMPDIR/cca-int node --import tsx/esm scripts/validate-cost-state.ts --write-doc
```

(`npm run validate` uses the `tsx` CLI, which needs a shell that can open unix sockets; the
`node --import tsx/esm` form above works everywhere.)

## Schema version and rebuilds

`core/db/schema.ts` keeps `SCHEMA_VERSION` (currently `3`) in `PRAGMA user_version`. On open, a
mismatch drops and recreates every table — the DB is a rebuildable cache, so there are no data
migrations to write. Anything that changes what a table stores (adding `context_items`, splitting
`cacheAssumed` out of `cache5m`) bumps this constant; the next `npm start` or `npm run validate`
against that `CCA_HOME` pays for one full reparse and nothing else.

## Screenshots

`scripts/screenshot.ts` (`npm run screenshot`) drives a running, already-indexed server with
Playwright and captures every page in both themes into `docs/screenshots/`:

```sh
npm run build && npm start &          # or point --base at a dev server
npm run screenshot -- --base http://127.0.0.1:4141
```

Flags: `--base <url>` (default `http://127.0.0.1:4141`), `--out <dir>` (default
`docs/screenshots`), `--themes <list>` (default `paper,slate`). It needs the **built** app, not the
Vite dev server, so pages render with production asset paths; run it against `npm start`. Two
frames also get copied to fixed names (`hero-overview.paper.png`, `hero-session.paper.png`) for the
README and the executive summary — regenerate it after any visual change to a page in
`STATIC_PAGES`.

## Test layers

| command | what it covers |
|---|---|
| `npm test` | vitest: parse, pricing, cost, db, server routes (all against fakes/fixtures, never the real DB) |
| `npm run typecheck` | `tsconfig.node.json` + `tsconfig.web.json` + `tsconfig.tests.json` — node, web **and** tests |
| `npm run build` | `tsc` to `dist/server` + `dist/core`, then `vite build` to `dist/web` |
| `npm run test:e2e` | builds, boots `dist/server/cli.js` on 4171 against `tests/fixtures/projects`, runs Playwright + axe |

`npm run typecheck` covers all three projects, tests included: `tsconfig.tests.json` now sets its
own `"exclude": ["node_modules", "dist", "web"]`, which is what makes `tests/**/*.ts` compile at
all (the `exclude` inherited from `tsconfig.node.json` dropped them silently).

One consequence for `web/src/lib/*`: a module a test imports directly is compiled **twice** —
once by `tsconfig.web.json` (Bundler resolution, `@/` and `@core/` aliases) and once by
`tsconfig.tests.json` (NodeNext, no aliases). Only relative specifiers with an explicit `.js`
extension satisfy both, which is why `lib/format.ts` and `lib/range.ts` import
`../../../core/types.js` rather than `@core/types`. Anything else under `web/src` may keep the
alias form; it is reached through a component, not by a test.

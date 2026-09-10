# demo mode — the synthetic dataset

`core/demo/**` generates a `~/.claude/projects`-shaped tree of invented transcripts so the app can
be demoed, screenshotted and recorded with nobody's real conversations on screen. Nothing in it
comes from a real machine: the workspace, the prompts, the file paths, the hook names and the MCP
servers are all fiction (`core/demo/content.ts`), and the generator never reads `~/.claude`.

```
core/demo/rng.ts        mulberry32 + draw helpers (seeded; no Math.random anywhere)
core/demo/content.ts    the fictional workspace: projects, titles, prompts, tools, hooks, filler
core/demo/generate.ts    shapes, token counts, timestamps, cost targets, the writer
scripts/gen-demo-data.ts CLI: writes the tree
scripts/demo.mjs         generate (once, or --fresh) then serve it with the built server
tests/core/demo/         determinism, discover+parse with zero warnings, feature coverage
```

## Commands

```sh
# data only (default --out ~/.claude-cost-analyzer/demo)
node --import tsx/esm scripts/gen-demo-data.ts --out .cca-scratch/demo/claude

# data + the built server on 4142 (needs `npm run build` first)
node scripts/demo.mjs --no-open
node scripts/demo.mjs --fresh --seed 7 --sessions 40 --port 4143

# data + the dev server (source, no build) on whatever --port you give it
node --import tsx/esm server/cli.ts --demo --no-open
node --import tsx/esm server/cli.ts --demo --seed 7 --sessions 10 --port 4143 --no-open
```

`server/cli.ts --demo` (`server/cli-flags.ts`, `resolveDemoDirs` in `cli.ts`) is a second, simpler
entry point into the same generator: no build step, and it always nests under
`<CCA_HOME>/demo/{projects,home}` rather than taking its own `--out`. It's meant for a quick look
under `npm run dev`-style source execution; reach for `scripts/demo.mjs`/`npm run demo` instead
when you actually need `--out`, `--fresh`, or to demo the built server (screenshots, recordings).
Generation is skipped whenever `<CCA_HOME>/demo/projects` already exists — delete it, or point
`--home`/`CCA_HOME` elsewhere, to regenerate with a different `--seed`/`--sessions`. `--demo` and
`--claude-dir` are mutually exclusive (both pick the transcript root; only one can win).

Suggested `package.json` wiring:

```json
"demo": "node scripts/demo.mjs",
"demo:data": "node --import tsx/esm scripts/gen-demo-data.ts"
```

`--out` is a demo **home**, not a projects dir:

```
<out>/projects   the transcript tree      → passed to the server as --claude-dir
<out>/home       index.sqlite + config.json → passed to the server as --home
```

Both are rebuildable caches. `--fresh` deletes them together, because a new seed produces new
session ids and a stale tree would otherwise be indexed alongside the new one.

## Knobs

| flag | default | effect |
|---|---|---|
| `--out <dir>` | `~/.claude-cost-analyzer/demo` | demo home (see layout above) |
| `--seed <n>` | `20260909` | changes every id, title choice, token count and timestamp |
| `--now <iso>` | `Date.now()` | the newest session lands on this day, so the date presets are populated |
| `--sessions <n>` | `62` | 5–400; the size/model/project mix scales with it |

`scripts/demo.mjs` adds `--port` (default 4142), `--fresh` and `--no-open`, and passes `--seed`,
`--sessions` and `--now` through to the generator.

Determinism is a hard requirement, not a nicety: `buildDemoTree({seed, now, sessions})` is pure and
returns a `Map<relativePath, text>`, so the same three inputs produce byte-identical files on any
machine. `writeDemoTree` is the only part that touches disk. A screenshot run and a video run of
the same seed therefore show the same numbers.

## What it produces (default seed and 62 sessions)

7 project directories, ~230 files, ~35 MB, ~11 k billed requests, ~$1.2 k at list prices, spread
over 35 days ending today. The last fortnight has at least one session per day so the 7- and
14-day presets are never empty; older days thin out.

| project dir | cwd | note |
|---|---|---|
| `-Users-dev-work-lumen-api` | `/Users/dev/work/lumen-api` | busiest |
| `-Users-dev-work-lumen-web` | `/Users/dev/work/lumen-web` | |
| `-Users-dev-work-lumen-infra` | `/Users/dev/work/lumen-infra` | |
| `-Users-dev-oss-tinyvec` | `/Users/dev/oss/tinyvec` | parent of the worktree |
| `-Users-dev-oss-tinyvec--claude-worktrees-feat-quantize` | `…/tinyvec/.claude/worktrees/feat-quantize` | nests under its parent in the UI |
| `-Users-dev-notes` | `/Users/dev/notes` | cheap sessions |
| `-private-tmp-scratch` | `/private/tmp/scratch` | scratch; hidden while `hideScratchProjects` is on |

Session sizes are planned, not accidental: 26 % "large" (\$30–\$88, subagents, sometimes a
workflow run), 19 % "medium" (\$4.50–\$20) and the rest log-normal small ones (\$0.18–\$3.40).
Spend by model lands near Opus 5 65 % / Sonnet 5 20 % / Fable 5.1 8 % / Haiku 4.5 7 %; subagents
run Sonnet or Haiku, and one nested subagent runs at `spawnDepth: 2`.

Line shapes covered (SPEC §3.2–3.5): `user` prompts, tool results and compact summaries;
`assistant` split one-per-content-block with a streaming `output_tokens: 5` placeholder and
out-of-order `apiBlockIndex`; `system` `stop_hook_summary` / `turn_duration` / `api_error` /
`compact_boundary` / `away_summary` / `local_command`; `attachment` hook records
(`hook_success`, `hook_additional_context`, `hook_blocking_error`, `hook_cancelled`) and 14 kinds
of harness injection, some with `rendered[]`; `ai-title`, `custom-title` (line and
`custom-title.json`), `agent-name`, `cost-state`, `pr-link`, `continued-in`, `mode`,
`permission-mode`, `queue-operation`, and an ignored `last-prompt`.

Usage shapes covered: `cache_creation.{ephemeral_5m,ephemeral_1h}` splits,
`output_tokens_details.thinking_tokens`, `server_tool_use.web_search_requests` on one request,
`speed: "fast"` on a few Opus requests, one `iterations` fallback (Fable 5.1 → Opus 4.8, billed per
iteration), `<synthetic>` zero-cost lines, one image in a tool result (1 600 tokens) and one in a
prompt, plus idle gaps long enough to expire the prompt cache and force a full re-write.

Sidecar files: `<session>/subagents/agent-<id>.jsonl` + `.meta.json`,
`<session>/subagents/workflows/wf_<id>/` with agents and `journal.jsonl`,
`<session>/custom-title.json`, `<session>/tool-results/*.txt` and `<session>/workflows/scripts/*.js`
(both of which discovery must skip), `sessions-index.json` per project, and a project-level
`memory/` directory (also skipped).

### Why the numbers are what they are

Token counts are generated *against the shipped price table* (`RATES` in `generate.ts` mirrors
`core/pricing/defaults.ts`), so each session is grown request by request until it reaches its
planned dollar target. Two consequences worth knowing:

- **`cost-state` is written to agree with the file.** Each session's tally is the exact sum of the
  tokens and dollars its own transcripts contain, so it classifies as `match`
  (`core/cost/reported.ts`). Three sessions carry a deliberate offset so the other statuses are
  demonstrable: one tally inflated ×1.85 (`tally-includes-earlier-process`, i.e. a forked or
  continued session), one deflated ×0.45 (`file-covers-more-than-tally`, a resumed one), and one
  with no billed request at all and a tiny input-only tally (`hidden-calls-only`, Claude Code's
  background title call). Expect 59 `match` + those three.
- **Tool-result text is sized to the tokens it claims.** The result text length is
  `tokens × 3.1 chars`, so the attribution estimator's delta check (`docs/METHODOLOGY.md` §3)
  usually succeeds instead of falling back to the raw heuristic. That is also why the on-disk size
  is dominated by filler text rather than by envelopes.

If you need a *smaller* dataset, lower `--sessions`; the per-request cost is what keeps the file
count down, so raising output-token ranges in `outputFor` shrinks the tree at the same dollar
total, and lowering them grows it.

### Deliberate deviations from a "tidy" demo

- **Compactions are frequent** (~90 over the default dataset, several per large session). Context
  grows past 184 k tokens every ~40 requests in a \$60 session, and a real one compacts just as
  often. Capping it lower would have made the compaction and re-warm insights unreadable.
- **The `Stop` hook shows as `(unnamed)` in the hooks table.** `stop_hook_summary.hookInfos`
  entries carry only `command` and `durationMs` — there is no `hookName` in the real format, and
  the parser has nothing to name the run with. Faithfulness wins over a prettier row.

## Gates

`npx vitest run tests/core/demo` covers determinism (same seed → identical bytes, different seed →
different bytes), discovery and parsing of a written tree with **zero warnings and zero parse
errors**, presence of every line shape listed above, the child links of every `Agent` and
`Workflow` call, the `cost-state` agreement described above, and the invariant that no string in
the output contains a `/Users/…` path other than `/Users/dev`.

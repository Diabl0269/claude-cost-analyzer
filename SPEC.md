# Claude Cost Analyzer — Design Specification (v1, 2026-09-07)

Binding for anyone working in this repo. Read fully before touching code. `core/types.ts` is the
shared contract between modules; extend it, don't fork it.

## 0. What and why

A local, single-user web app that reads Claude Code transcripts from `~/.claude/projects` and shows what
every conversation, turn, tool call, subagent, workflow, hook, and harness injection costs at API list
prices. Motivation: the team is moving from a subscription to pay-per-token billing. People need to see and
shape their spend before the switch. Nothing leaves the machine.

## 1. Non-negotiables

1. **No network at runtime.** Fonts are bundled from `@fontsource-variable/*`. No CDNs, no telemetry, no
   update checks.
2. **Server binds `127.0.0.1` only.** Every `/api/*` route sits behind the auth middleware in §7.3. No
   wildcard CORS (do not emit `Access-Control-Allow-Origin` at all). Never put tokens in URLs or query
   strings.
3. **All SQL is parameterized** (`node:sqlite` prepared statements). Table/column names are literals in
   code, never interpolated from input. Validate every request body and query string with `zod`.
4. **Never log transcript content.** Logs carry counts, paths, durations, error classes only.
5. **Dependencies are frozen** to what is in `package.json`. Do not add or upgrade any without a
   license check; if something is truly missing, stop and report it instead of running `npm install`.
6. **No real transcript content in the repo.** Fixtures under `tests/fixtures` are synthetic (invented
   prompts like "Rename the helper in utils.ts"). You may read `~/.claude/projects` locally to test against
   real data, but never copy lines from it into files in this repo.
7. **Accessibility is WCAG 2.2 AA** (§9). **Design brief §8 is binding**, not inspiration.
8. TypeScript `strict`, ESM, Node 22 (`node:sqlite` is built in; FTS5 and the trigram tokenizer are verified
   available; SQLite 3.51). Suppress the ExperimentalWarning for `node:sqlite` via
   `process.removeAllListeners('warning')`-style filtering only for that warning name, in `server/cli.ts`.
9. Write code a careful senior engineer would sign: small modules, named types from `core/types.ts`,
   no `any` except at JSON parse boundaries (narrow immediately), no dead code, no TODOs left behind.

## 2. Repository layout

```
package.json  tsconfig.base.json  tsconfig.node.json  tsconfig.web.json  vite.config.ts  vitest.config.ts
playwright.config.ts  .gitignore  SPEC.md  README.md  CONTRIBUTING.md
core/                 pure TypeScript, no HTTP, no React
  types.ts            SHARED CONTRACT (domain + API). Append-only; never rename or repurpose a field.
  discover.ts         walk roots → DiscoveredSession[]                          (parser module)
  jsonl.ts            streaming line reader with byte offsets                    (parser module)
  parse/              transcript → ParsedTranscript (+ titles, hooks, ...)      (parser module)
  pricing/            default table, resolver, money math, formatting           (cost/index module)
  cost/               request cost, attribution (tool calls / injections)       (cost/index module)
  db/                 schema, indexer, queries, search                          (cost/index module)
  index.ts            barrel
server/               Hono app
  index.ts app.ts auth.ts routes/*.ts sse.ts watcher.ts config.ts static.ts cli.ts worker.ts
web/                  Vite + React 19
  index.html  src/main.tsx  src/app/{App,routes,shell}.tsx  src/design/*.css  src/components/**
  src/lib/{api.ts,format.ts,hooks.ts,keyboard.ts,a11y.ts}
  src/routes/<page>/Page.tsx
scripts/              dev.mjs (spawns server+vite), validate-cost-state.ts, screenshot.ts
tests/
  core/**             vitest unit tests (parse, pricing, cost, db)
  fixtures/projects/  synthetic ~/.claude/projects tree used by unit + e2e tests
  e2e/**              Playwright + axe
docs/                 executive-summary.html, METHODOLOGY.md, screenshots/
```

## 3. Data source facts (verified against 680 real JSONL files, Claude Code 2.1.149–2.1.263)

### 3.1 Layout on disk

```
~/.claude/projects/<projectDirName>/                 projectDirName = cwd with "/" → "-" (lossy; use cwd field)
  <sessionId>.jsonl                                  main transcript (515 on this machine)
  <sessionId>/custom-title.json                      {"customTitle":"..."} (optional)
  <sessionId>/subagents/agent-<agentId>.jsonl        subagent transcript (Agent tool)
  <sessionId>/subagents/agent-<agentId>.meta.json    {"agentType","description","toolUseId","parentAgentId","spawnDepth","model"}
  <sessionId>/subagents/workflows/wf_<runId>/        Workflow tool run
      agent-<agentId>.jsonl + .meta.json             agents spawned by the workflow script
      journal.jsonl                                  {"type":"started|result|failed","key","agentId","result"?}
  <sessionId>/tool-results/*.txt                     persisted large tool outputs (NOT in context; ignore for cost)
  <sessionId>/workflows/scripts/*.js                 workflow scripts (ignore)
  sessions-index.json                                optional {"version":1,"entries":[{sessionId,fullPath,fileMtime,firstPrompt,summary,messageCount,created,modified,gitBranch,projectPath,isSidechain}]}
  memory/*.md, .session-aliases                      ignore
```
Legacy formats to tolerate (not present here, but real in older Claude Code): `agent-<id>.jsonl` directly in the
project dir, and sidechain lines (`isSidechain:true`, `agentId`) inside the main file. Group those by
`agentId` into synthetic agents.

Directory names start with `-`; always use `./` prefixes or `path.join`, never shell globs.

### 3.2 Line types (top-level `type`)

| type | what | keep |
|---|---|---|
| `user` | user prompt (`message.content` string or blocks) or tool results (`tool_result` blocks; `toolUseResult` has structured result; `sourceToolUseID`) | yes |
| `assistant` | one API response, BUT split across several lines (one per content block, `apiBlockIndex`), all sharing `message.id` and `requestId`. `message.usage`, `message.model`, `message.stop_reason`. Extra fields: `effort`, `attributionSkill`, `attributionPlugin`, `attributionMcpServer`, `attributionMcpTool`, `isApiErrorMessage`, `isAbortedMidStream` | yes |
| `system` | `subtype` ∈ `stop_hook_summary` (hookCount, hookInfos[{command,durationMs}], hookErrors, hookAdditionalContext[]), `turn_duration` (durationMs, messageCount), `api_error` (error{status,message}, retryAttempt, maxRetries), `compact_boundary` (compactMetadata{trigger,preTokens,postTokens,durationMs,...}), `away_summary`, `local_command` (content has `<command-name>/x</command-name>`), `informational`, `model_refusal_fallback` | yes |
| `attachment` | harness injections and hook records; `attachment.type` see §3.4; optional `rendered:[{content}]` = what actually entered context | yes |
| `ai-title` `custom-title` `agent-name` | session titles (`aiTitle`, `customTitle`, `agentName`) | yes |
| `cost-state` | Claude Code's own running tally: `totalCostUSD`, `modelUsage{model:{inputTokens,outputTokens,thinkingTokens?,cacheReadInputTokens,cacheCreationInputTokens,webSearchRequests,costUSD}}`, `totalAPIDuration`, `totalDuration`, `totalToolDuration`, `totalLinesAdded/Removed`, `hasUnknownModelCost`. Model keys may carry `[1m]` suffix. Last one wins. Present in 52 sessions. **Use as validation oracle.** | yes |
| `pr-link` `continued-in` `relocated` `worktree-state` `mode` `permission-mode` `agent-setting` `queue-operation` | session facts; keep cheap counts/values | light |
| `last-prompt` `file-history-snapshot` `file-history-delta` `atis-latch` `agent-color` | ignore | no |

Common envelope fields: `uuid`, `parentUuid`, `timestamp` (ISO), `sessionId`, `cwd`, `gitBranch`, `version`,
`entrypoint` (`cli` | `claude-desktop` | `sdk-cli`), `sessionKind` (`bg` or absent), `isSidechain`, `isMeta`,
`slug`, `agentId` (subagent files), `promptId`.

### 3.3 `message.usage` (assistant)

```json
{"input_tokens":2,"cache_creation_input_tokens":3928,"cache_read_input_tokens":153998,"output_tokens":117,
 "output_tokens_details":{"thinking_tokens":0},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},
 "service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":3928,"ephemeral_5m_input_tokens":0},
 "inference_geo":"global","iterations":[{...same shape...,"type":"message","model"?:"..."}],"speed":"standard"}
```
Facts:
- `cache_creation.{ephemeral_5m,ephemeral_1h}` present on 100% of lines here; if absent, treat
  `cache_creation_input_tokens` as 5m (configurable in pricing settings) and flag `assumedTtl`.
- **Dedup is mandatory and subtle.** 21,696 assistant lines → 9,356 unique `message.id`. Lines of the same
  message often carry DIFFERENT usage (first line is a streaming placeholder with `output_tokens: 5`; a later
  line has the final count). Rule: group by `message.id` (fallback `requestId`, fallback `uuid`); the billing
  record is the line with the **largest `output_tokens`** (tie → last in file order). Merge all lines' content
  blocks in `apiBlockIndex` order (fallback file order) to form the message.
- `iterations`: normally one element equal to top-level usage. 4 cases had 2 elements: a `fallback_message`
  (model fell back, e.g. `claude-fable-5` → `claude-opus-4-8`); top-level usage equals only the LAST iteration.
  Rule: if `iterations.length > 1`, bill each iteration at `iteration.model ?? message.model`; else bill top-level.
- `model === "<synthetic>"` (with zero usage, `isApiErrorMessage` often true) = client-side synthetic message.
  Zero cost, excluded from request counts, kept in transcript.
- `speed` ∈ {`standard`, `fast`}; `service_tier` ∈ {`standard`, `priority`?, `batch`?}; `inference_geo` ∈
  {`global`, `us`}. Only `standard`/`global` seen here but pricing must honor `fast` and `us` (§5.2).
- Models seen: `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-fable-5-1`, `claude-opus-4-8`,
  `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `<synthetic>`. `cost-state` uses `claude-opus-5[1m]`.
- `stop_reason` ∈ {`tool_use`, `end_turn`, `stop_sequence`}. `output_tokens` already INCLUDES thinking tokens.

### 3.4 Attachment types

Hooks: `hook_success` {hookName "SessionStart:startup", hookEvent, command, durationMs, exitCode, stdout, stderr},
`hook_additional_context` {content: string[]} (this text enters the model context),
`hook_blocking_error` {hookName, hookEvent, blockingError{blockingError: string, command}},
`hook_cancelled` {hookName, hookEvent, command, durationMs, timedOut, timeoutMs}.

Harness injections (each is text that entered context; prefer `rendered[].content` length when present):
`total_tokens_reminder`{text} (5201×), `deferred_tools_delta`, `agent_listing_delta`{addedLines[]},
`mcp_instructions_delta`{addedBlocks[]}, `skill_listing`{content}, `task_reminder`{content[]},
`sandbox_instructions`{content}, `command_permissions`, `edited_text_file`{snippet}, `read_truncation_notice`,
`queued_command`{prompt}, `date_change`, `date`, `file`{content.file.content}, `auto_mode`, `environment`,
`model`{text}, `instructions`, `session_context`, `prompt_snapshot`{systemPrompt[]} (the full system prompt;
count it as `system_prompt` injection only when rendered), `deferred_tools_record`, `bash_output_audience_note`,
`batching_reminder_sent`, `ultra_effort_enter/exit`, `plan_mode`, `plan_mode_exit`, `compact_file_reference`,
`thinking_stripped`, `nested_memory`, `fork_briefing`{text}, `invoked_skills`, `structured_output`,
`workflow_keyword_request`. Unknown types: keep, category `other`, chars from `rendered` or JSON length of
`attachment` minus envelope (cap at 0 if unsure → tokens 0 with `estMethod:'none'`).

### 3.5 Tool calls and children

- `tool_use` blocks: `{type:'tool_use', id:'toolu_…', name, input}`; matching `tool_result` in a later `user`
  line: `{type:'tool_result', tool_use_id, content: string | [{type:'text'|'image'|'tool_reference', …}], is_error?}`.
  The `user` line also carries `toolUseResult` (structured, tool-specific) and `sourceToolUseID`.
- **Agent tool** (`name: "Agent"`, input {description, prompt, subagent_type?, model?}): result
  `toolUseResult` = async `{isAsync:true,status:'async_launched',agentId,description,resolvedModel,prompt,outputFile}`
  or sync `{agentId,agentType,content,prompt,status,toolStats,totalDurationMs,totalTokens,totalToolUseCount,usage}`.
  Link tool_use ↔ `subagents/agent-<agentId>.jsonl`; `meta.json.toolUseId` is the authoritative reverse link.
  Nested agents: `meta.parentAgentId`, `spawnDepth`.
- **Workflow tool** (`name: "Workflow"`): `toolUseResult` `{runId:'wf_…',scriptPath,status,summary,taskId,transcriptDir,workflowName}`.
  All agents in `subagents/workflows/<runId>/` belong to that run; parent = this tool_use.
- MCP tools: `mcp__<server>__<tool>`; server may be a UUID (claude.ai connectors). Parse `server` and `tool`.
- `Skill`, `ToolSearch`, `StructuredOutput`, `SendMessage`, `Monitor`, `TaskOutput`, `TaskStop`,
  `ScheduleWakeup`, `EnterWorktree`, `ExitWorktree`, `AskUserQuestion`, `WebFetch`, `WebSearch`, `Bash`,
  `Read`, `Write`, `Edit`, `ListAgents`, `RemoteTrigger`, … (treat names as open set).

### 3.6 Other useful files
- `~/.claude/history.jsonl`: `{display, pastedContents, timestamp(ms), project, sessionId?}` → optional
  fallback for first prompt.
- `~/.claude/stats-cache.json`: Claude Code's aggregate `modelUsage` → optional second oracle (whole-history).

## 4. Domain model (see `core/types.ts`)

- **Project** = a `projectDirName` directory. Display path = most common `cwd` among its sessions
  (fallback: decode dirName). Detect worktrees: cwd containing `/.claude/worktrees/` → `parentPath` = part
  before it; UI nests them under the parent.
- **Session** = one main file + its agents + its workflow runs. Session totals = Σ requests over ALL its
  transcripts, each request counted exactly once.
- **Transcript** = one JSONL file (main, subagent, or workflow agent). `seq` = 0-based line index in that
  file; every extracted item carries `seq` and `(byteOffset, byteLength)` so the transcript can be re-read
  lazily.
- **Request** = one billed API call (deduped assistant message, §3.3). `contextTokens = input + cacheRead
  + cache5m + cache1h`.
- **Turn** = a user prompt (non-meta, non-tool-result `user` line) and everything until the next one.
  `turnIndex` on requests/messages.
- **Tool call**, **Injection** (hook context, harness attachment, user prompt text, compact summary),
  **Hook run**, **Compaction**, **Agent**, **Workflow run**.
- **Title** priority: last `custom-title` line → `<session>/custom-title.json` → last `ai-title` → last
  `agent-name` → `sessions-index.json` `summary` → cleaned first prompt → `slug` → short sessionId.
  Cleaning: drop `<command-name>…</command-name>`, `<command-message>…`, `<command-args>` wrappers (keep args
  text), `<local-command-stdout>…`, `<system-reminder>…</system-reminder>`, `<task-notification>…`; collapse
  whitespace; first 120 chars. Slash-command-only prompts render as `/<command> <args>`.
- **Prompt kinds** for `user` lines: `prompt` (human text), `tool_result`, `compact_summary`
  (`isCompactSummary`), `meta` (`isMeta` or content wrapped entirely in `<system-reminder>`/`<task-notification>`
  or `<local-command-…>`), `interrupt` (`[Request interrupted by user…]`).

## 5. Cost model

### 5.1 Request cost (exact)
For each billed unit (iteration or top-level usage) with resolved price `P` (USD per token, from USD/MTok ÷ 1e6):
```
cost = input·P.in + output·P.out + cache5m·P.w5 + cache1h·P.w1 + cacheRead·P.read
     + webSearchRequests · webSearchPer1000/1000
```
Modifiers: `speed === 'fast'` → use `P.fast` if the model defines it (else standard). `inference_geo === 'us'`
and model `supportsUsGeo` → ×1.1 on all token terms. `service_tier === 'batch'` → ×0.5 on token terms.
Unknown model → `unknownModelPolicy`: `zero` (default; flagged `unpriced`) or `fallbackModel`.
Long context (>200K) is standard price for 4.6+ models (verified in docs; matches Claude Code's own tally).

### 5.2 Default pricing table (USD per MTok; source platform.claude.com/docs/en/about-claude/pricing, 2026-09-07)

| key | label | match prefixes (after stripping `[1m]`) | in | out | w5m | w1h | read | fast in/out | chars/tok |
|---|---|---|---|---|---|---|---|---|---|
| fable-5.1 | Claude Fable 5.1 | claude-fable-5-1 | 10 | 50 | 12.5 | 20 | 0.25 | — | 3.1 |
| mythos-5.1 | Claude Mythos 5.1 | claude-mythos-5-1 | 10 | 50 | 12.5 | 20 | 0.25 | — | 3.1 |
| fable-5 | Claude Fable 5 | claude-fable-5 | 10 | 50 | 12.5 | 20 | 1 | — | 3.1 |
| mythos-5 | Claude Mythos 5 | claude-mythos-5 | 10 | 50 | 12.5 | 20 | 1 | — | 3.1 |
| opus-5 | Claude Opus 5 | claude-opus-5 | 5 | 25 | 6.25 | 10 | 0.5 | 10/50 (w5 12.5, w1 20, read 1) | 3.1 |
| opus-4.8 | Claude Opus 4.8 | claude-opus-4-8 | 5 | 25 | 6.25 | 10 | 0.5 | 10/50 | 3.1 |
| opus-4.7 | Claude Opus 4.7 | claude-opus-4-7 | 5 | 25 | 6.25 | 10 | 0.5 | — | 3.1 |
| opus-4.6 | Claude Opus 4.6 | claude-opus-4-6 | 5 | 25 | 6.25 | 10 | 0.5 | — | 4.0 |
| opus-4.5 | Claude Opus 4.5 | claude-opus-4-5 | 5 | 25 | 6.25 | 10 | 0.5 | — | 4.0 |
| opus-4.1 | Claude Opus 4.1 | claude-opus-4-1 | 15 | 75 | 18.75 | 30 | 1.5 | — | 4.0 |
| opus-4 | Claude Opus 4 | claude-opus-4-2, claude-opus-4 (exact) | 15 | 75 | 18.75 | 30 | 1.5 | — | 4.0 |
| sonnet-5 | Claude Sonnet 5 | claude-sonnet-5 | 2 | 10 | 2.5 | 4 | 0.2 | — | 3.1 |
| sonnet-4.6 | Claude Sonnet 4.6 | claude-sonnet-4-6 | 3 | 15 | 3.75 | 6 | 0.3 | — | 4.0 |
| sonnet-4.5 | Claude Sonnet 4.5 | claude-sonnet-4-5 | 3 | 15 | 3.75 | 6 | 0.3 | — | 4.0 |
| sonnet-4 | Claude Sonnet 4 | claude-sonnet-4-2, claude-sonnet-4 (exact) | 3 | 15 | 3.75 | 6 | 0.3 | — | 4.0 |
| sonnet-3.7 | Claude Sonnet 3.7 | claude-3-7-sonnet | 3 | 15 | 3.75 | 6 | 0.3 | — | 4.0 |
| haiku-4.5 | Claude Haiku 4.5 | claude-haiku-4-5 | 1 | 5 | 1.25 | 2 | 0.1 | — | 4.0 |
| haiku-3.5 | Claude Haiku 3.5 | claude-3-5-haiku | 0.8 | 4 | 1 | 1.6 | 0.08 | — | 4.0 |
| synthetic | (synthetic) | `<synthetic>` | 0 | 0 | 0 | 0 | 0 | — | 4.0 |

Matching: normalize (`lowercase`, strip `[1m]`, strip `@…`), choose the model whose prefix match is longest;
`(exact)` entries match only when nothing longer matches. `supportsUsGeo` = true for 4.6 and later.
`webSearchPer1000 = 10`. Sanity anchors from real `cost-state`: Haiku 4.5 line `6735 in + 18 out = $0.006825`
(exact); a 700-turn Opus 5 session at $143.50 fits 1h-heavy cache writes. Sonnet 5 introductory $2/$10 is
now permanent (docs note).

### 5.3 Attribution (estimated; always labelled "est." in UI)

Goal: answer "what did THIS tool call / hook / injection / prompt cost me?" Requests are exact; attribution
splits a request's cost among the things that filled its context.

Definitions per transcript, requests `R_0..R_n` in file order:
- **Output share.** Blocks of `R_i`: thinking, text, tool_use (JSON of `input`). `thinkingTokens` (from
  `output_tokens_details`) go to thinking blocks; the remainder of `output_tokens` is split across text and
  tool_use blocks proportionally to their char lengths. `genCost(block) = shareTokens · P.out(model_i)`.
- **Gap items.** Everything in file order between `R_i` and `R_{i+1}`: tool results (chars of
  `tool_result.content`; images count as 1,600 tokens each, `estMethod:'image'`), user prompt text,
  attachments (rendered chars), hook context, compact summaries. Each item gets `chars`.
- **Token estimate.** `H = Σ chars/charsPerToken(model_{i+1})`. `Δ = context(R_{i+1}) − context(R_i) −
  output(R_i)`. If no compaction in the gap and `Δ > 0` and `0.4 ≤ Δ/H ≤ 2.5`: `tokens = chars/cpt · (Δ/H)`
  with `estMethod:'delta'`; else `tokens = chars/cpt`, `estMethod:'heuristic'`. For `i = 0` (first request)
  everything before `R_0` is `heuristic`.
- **Ingest cost.** Item enters context at `R_{i+1}`:
  `newTokenPrice(R) = (input·P.in + c5·P.w5 + c1·P.w1) / (input + c5 + c1)` (if denominator 0 → `P.in`).
  `ingestCost = tokens · newTokenPrice(R_{i+1})`.
- **Carry cost.** The item is re-sent in every later request until a `compact_boundary` or transcript end:
  `avgContextPrice(R_k) = (input·P.in + c5·P.w5 + c1·P.w1 + cacheRead·P.read) / context(R_k)`.
  `carryCost = tokens · Σ_{k=i+2}^{lastCarrySeq} avgContextPrice(R_k)`. Store `ingestRequestSeq` and
  `lastCarrySeq` so money is computed at read time from current pricing (prefix sums over the transcript).
- **Tool call total (est.)** = `genCost(tool_use block) + ingestCost(result) + carryCost(result)`.
  Plus `childCost` (exact) for Agent/Workflow tool calls = Σ requests of the linked agent(s). Show own vs
  child separately; never add child cost into the parent transcript's own totals.
- **Hook cost (est.)** = ingest + carry of text it injected: `hook_additional_context.content[]`,
  `hook_blocking_error.blockingError`, `stop_hook_summary.hookAdditionalContext[]`, and `hook_success.stdout`
  only when `hookEvent ∈ {UserPromptSubmit, SessionStart}` and stdout is non-empty and not JSON. Hooks also
  cost time (`durationMs`); report it.
- **Harness overhead (est.)** = ingest + carry of all non-hook attachments, grouped by `attachment.type`.
- **Compaction.** Record `preTokens`, `postTokens`, `durationMs`, `trigger`, and `rewarmCost` = cache-write
  cost of the first request after the boundary (exact from that request's usage).
- **Category split (exact)** per request/session: output$, input$, cacheWrite$ (5m+1h), cacheRead$,
  webSearch$. **Cache hit ratio** = cacheRead / context. **Cold-cache request** = context > 20K and
  cacheRead == 0.

### 5.4 Validation oracle
`scripts/validate-cost-state.ts` indexes the real `~/.claude/projects`, then for every session with a
`cost-state` line compares computed total (main + agents, all models) vs `totalCostUSD` and per-model
`costUSD`; prints a table (session, reported, computed, Δ%, models) and a summary (median |Δ%|, worst 5).
Target: median |Δ| ≤ 2%. Note `cost-state` may span only the process lifetime (resumed sessions) — flag
sessions whose computed > reported by >10% as "likely resumed" rather than failing.

## 6. Indexing and storage

- DB: `~/.claude-cost-analyzer/index.sqlite` (dir + file mode 0600), `CCA_HOME` overrides. Config
  (pricing, settings, pins) in `~/.claude-cost-analyzer/config.json`, never in the DB. The DB is a rebuildable
  cache; `POST /api/reindex {full:true}` deletes and rebuilds.
- Incremental: `files(path, size, mtimeMs)`; reparse a session when its main file or any agent file changed;
  rewrite that session's rows in one transaction. Roots default `["~/.claude/projects"]`, configurable.
- Indexing runs in a `worker_threads` worker; progress events (files done/total, current project, phase)
  stream to the UI via SSE. Watcher: `fs.watch(root, {recursive:true})`, per-file quiet period 3 s, then
  incremental index; broadcast `sessionsChanged`.
- Tables (all with sensible indexes; FKs on sessionId; see `core/db/schema.ts`):
  `files, projects, sessions, agents, workflow_runs, requests, tool_calls, injections, hook_runs, compactions,
  messages, sessions_fts(title, firstPrompt, projectPath, sessionId UNINDEXED) [fts5 trigram],
  messages_fts(text, messageRowid UNINDEXED) [fts5 unicode61 remove_diacritics 2]`.
  `messages` stores role/kind/seq/turnIndex/ts/messageId/requestSeq/`fileId`/`byteOffset`/`byteLength`/
  `preview` (first 240 chars) but NOT full content; transcript reads go back to the JSONL by offset.
  `messages_fts.text` = the searchable text of that line (prompt text, assistant text + thinking, tool_use
  name + input JSON, tool_result text). Tokens stored as integers; money is never stored.
- Search: title search uses trigram FTS (substring, case-insensitive); content search uses unicode61 with
  `snippet()` + `bm25()`, filters by project/date/model/kind/tool applied in SQL joins, results grouped by
  session with up to 3 snippets each, paginated.

## 7. Server and API

### 7.1 Runtime
`server/cli.ts`: parse flags (`--port` default 4141, `--host` fixed 127.0.0.1, `--no-open`, `--claude-dir`,
`--reindex`), start indexer worker, start Hono via `@hono/node-server` on `127.0.0.1`, print
`http://127.0.0.1:<port>/`, open browser on macOS via `child_process.spawn('open', [url])` unless `--no-open`.
Serve `dist/web` statically with SPA fallback (paths not starting with `/api`). Vite dev server proxies `/api`.

### 7.2 Endpoints (all JSON unless noted; types in `core/types.ts` §API)
```
POST /api/auth/session                 → 204, sets cookie (see 7.3)
GET  /api/status                       → StatusResponse
GET  /api/projects                     → ProjectsResponse
GET  /api/sessions?…SessionsQuery      → SessionsResponse
GET  /api/sessions/:id                 → SessionDetail
GET  /api/sessions/:id/transcript?agentId&fromSeq&limit → TranscriptPage
GET  /api/sessions/:id/agents          → AgentTreeResponse
GET  /api/search?…SearchQuery          → SearchResponse
GET  /api/analytics/overview?…RangeQuery   → OverviewResponse
GET  /api/analytics/tools?…RangeQuery      → ToolsAnalyticsResponse
GET  /api/analytics/models?…RangeQuery     → ModelsAnalyticsResponse
GET  /api/analytics/hooks?…RangeQuery      → HooksAnalyticsResponse
GET  /api/analytics/attribution?…RangeQuery→ AttributionAnalyticsResponse (skills, plugins, MCP servers)
GET  /api/analytics/insights?…RangeQuery   → InsightsResponse
GET  /api/pricing                      → PricingConfig
PUT  /api/pricing                      → PricingConfig (zod-validated body)
POST /api/pricing/reset                → PricingConfig
GET  /api/settings                     → UserSettings
PUT  /api/settings                     → UserSettings (zod-validated)
POST /api/sessions/:id/pin             → { pinned: boolean }
POST /api/reindex                      → { started: true }   body { full?: boolean }
GET  /api/events                       → text/event-stream of IndexEvent
GET  /api/export/sessions.csv?…SessionsQuery → text/csv
GET  /api/export/sessions/:id.json     → SessionExport
```
Errors: `{ error: { code, message } }` with proper status; 400 on validation failure (never echo raw input).

### 7.3 Auth middleware (`server/auth.ts`)
Single-user loopback tool, hardened against cross-site and DNS-rebinding access to transcripts:
1. Request `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (also the Vite dev origin when
   `CCA_DEV=1`); else 403.
2. If `Sec-Fetch-Site` is present it must be `same-origin` or `none`; if `Origin` is present it must equal the
   allowed origin; else 403.
3. `POST /api/auth/session` (subject to 1–2) issues `cca_session=<32 random bytes hex>`; `HttpOnly;
   SameSite=Strict; Path=/`. The token lives only in server memory for the process lifetime.
4. Every other `/api/*` route requires that cookie to match; else 401 `{error:{code:'unauthenticated'}}`.
   The web client calls `/api/auth/session` on startup and retries once on 401.
No CORS headers of any kind. Static assets are unauthenticated. Security headers: `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, a CSP allowing only `'self'` (fonts/images from self, `data:` for
inline SVG images), `Cache-Control: no-store` on `/api`.

## 8. Design brief — "The Ledger"

Not a dashboard template. Think a beautifully typeset financial statement crossed with a precision
instrument panel: paper, ink, hairlines, tabular numerals, one red for cost, one green for savings.
No card grids with drop shadows, no purple gradients, no glassmorphism, no rounded-pill everything, no
Inter/Roboto, no emoji as icons, no stock illustration.

### 8.1 Tokens (`web/src/design/tokens.css`)
Light theme "paper" (default follows `prefers-color-scheme`, manual toggle persisted):
```
--paper:#F4EFE6 --paper-2:#FBF8F2 --paper-3:#EAE3D5 --ink:#17150F --ink-2:#4A463D --ink-3:#736D60
--rule:rgba(23,21,15,.14) --rule-strong:rgba(23,21,15,.36) --focus:#1F5FBF
--cost:#B42318 --save:#1F7A5C --warn:#9A6700 --info:#1F5FBF
model hues: --m-opus:#3B3B98 --m-sonnet:#1D7A78 --m-haiku:#B7791F --m-fable:#8B1E3F --m-mythos:#5E2B97 --m-other:#6B6B6B
token classes: --t-output:var(--ink) --t-input:#B42318 --t-cache-write:#C77D1B --t-cache-read:#5B9E93
```
Dark theme "slate": `--paper:#111318 --paper-2:#181B22 --paper-3:#0C0E12 --ink:#EDE7DB --ink-2:#BDB6A7
--ink-3:#8E877A --rule:rgba(237,231,219,.14) --rule-strong:rgba(237,231,219,.38) --cost:#F0665C
--save:#48C596 --warn:#E3B341 --info:#7AA7F0`; model hues lightened for contrast. All text ≥ 4.5:1, UI
graphics ≥ 3:1 (verify with a contrast function in tests).
Spacing 4px grid (`--s1:4px … --s8:32px`), radii `--r1:2px --r2:4px --r3:8px` (nothing rounder except
avatars/dots), hairline borders only, no box shadows except a 1px inset ring on focused rows and a soft
elevation for dialogs/popovers (`0 12px 32px rgba(0,0,0,.18)`).
Type: `--font-display: 'Fraunces Variable', Georgia, serif` (headings, KPI numerals; set
`font-variation-settings:'opsz' 144,'SOFT' 30,'WONK' 0`), `--font-ui: 'Geist Variable', system-ui, sans-serif`,
`--font-mono: 'Geist Mono Variable', ui-monospace, monospace` (all numbers in tables, ids, tokens, money).
Scale: 12/13/14/16/20/28/40/56. Line-height 1.45 body, 1.1 display. `font-variant-numeric: tabular-nums
slashed-zero` on every numeric cell. Motion 160 ms ease-out, none under `prefers-reduced-motion`.

### 8.2 Shell
Three columns: left rail 264px (collapsible to 56px; nav + project tree), main column, optional inspector
320px. Top bar 48px: wordmark "Claude Cost Analyzer" in Fraunces, global search field (⌘K / Ctrl-K), date
range control, theme toggle, index-status pill (live: "Indexing 214/515", "Up to date · 12:04"). Left rail
bottom: total spend for the selected range in display numerals. Below 1024px the rail becomes a drawer.

### 8.3 Signature components (`web/src/components/**`)
`LedgerTable` (hairline rows 36px, right-aligned numerals, sticky header, sortable with `aria-sort`, arrow-key
row navigation, row actions), `Receipt` (label……amount rows with dotted leaders; used for session summaries),
`Kpi` (display numeral, label, optional delta), `CostWaterfall` (SVG; one bar per request, x = order or
time, height = cost, stacked by token class; keyboard-focusable bars with a tooltip and a synced list),
`ContextStrip` (stacked horizontal bar of what fills context at a request: system/harness, prompts,
assistant output, tool results by tool, hook context), `HeatStrip` (daily cost strip for a range),
`PlanGauge` (subscription vs pay-per-token), `TokenBar` (4-class stacked bar), `ModelChip` (hue + distinct
glyph shape so color is never the only channel), `TreeNav` (WAI-ARIA tree), `CommandPalette`, `Tabs`,
`SegmentedControl`, `Switch`, `NumberField`, `Select`, `DateRange`, `Dialog`, `Popover`, `Tooltip`,
`Toast`, `Skeleton`, `EmptyState`, `Callout`, `Sparkline`, `EstimateBadge` ("est." with methodology
tooltip), `Money`, `Tokens`, `Duration`, `RelativeTime`.
Every chart: `role="img"` + `aria-label` summary, `<title>/<desc>`, a "Show as table" toggle rendering the same
data in a `LedgerTable`, and keyboard focus on data marks where they carry tooltips.

### 8.4 Pages
- **Overview `/`**: range KPIs (spend, requests, sessions, cache hit ratio, cost per prompt), HeatStrip,
  spend by model (TokenBar per model), spend by project (LedgerTable), category split, top 8 sessions,
  PlanGauge vs configured plan, budget progress + month-end forecast, top insights (3).
- **Sessions `/sessions`, `/sessions/:id`**: project tree in rail; center: session list (LedgerTable; sort by
  recent/cost/duration; columns title, project, started, duration, models, prompts, requests, cost,
  reported-by-Claude-Code Δ badge). Detail tabs: **Summary** (Receipt: by category, by model, main vs
  subagents vs workflows, harness overhead, hooks; CostWaterfall; ContextStrip at selected request;
  compactions; facts: branch, version, entrypoint, effort, PR links, continued-in chain), **Transcript**
  (virtualized; turn headers with turn cost; assistant messages with request cost chip; tool calls as
  collapsible rows showing name, input summary, result size, gen/ingest/carry est. costs, child agent link;
  thinking collapsed; jump-to via `#seq`), **Tools**, **Agents** (tree with cost per agent; click →
  transcript), **Hooks & Harness**, **Timeline** (turn durations, API errors, idle gaps).
- **Search `/search`**: scope toggle Titles / Everything; filters project, date, model, kind (prompts,
  assistant, tools, thinking), tool name; results grouped by session with highlighted snippets; Enter opens
  the session at that message.
- **Analytics** `/analytics/tools|models|hooks|attribution`: LedgerTables + small charts.
- **Insights `/insights`**: ranked findings with money impact (see §10).
- **Settings `/settings`**: pricing table editor (inline editable LedgerTable, validation, reset, "source"
  note, unknown-models list with add-price action), plan comparison (plan preset + price), monthly budget,
  currency display (USD default; optional manual rate + code), roots, theme, data (reindex, DB size, path).
- **Methodology `/methodology`**: plain-language explanation of exact vs estimated numbers with formulas.

## 9. Accessibility (WCAG 2.2 AA; verified by axe in e2e and by hand)
Landmarks (`header nav main aside`), skip link, logical heading order, visible 2px focus ring offset 2px
(`--focus`), all interactions keyboard-operable (tree, tables, tabs, dialogs with focus trap + Escape +
restore focus, palette), `aria-live="polite"` for index status and toasts, `aria-sort`, labels on all
controls, `aria-describedby` for errors and estimate explanations, no color-only meaning (glyphs/patterns
+ text), respects `prefers-reduced-motion` and `prefers-contrast`, layout survives 200% zoom and 320px
width, hit targets ≥ 24px, tooltips dismissible/hoverable/persistent (1.4.13), no time limits, page
`<title>` updates per route, `lang="en"`.

## 10. Additional features (implement all)
1. Subscription vs pay-per-token comparison per calendar month (plan presets: Pro $20, Max 5x $100,
   Max 20x $200, Team Premium $125/seat, custom). 2. Monthly budget with forecast (linear run-rate).
3. Insights engine (server, `core/cost/insights.ts`): most expensive tool results by carry cost; sessions
   with most compactions and their rewarm cost; cold-cache requests cost; harness overhead share; hook
   overhead share and slowest hooks; Fable/Opus share and "what if all Fable requests were Opus 5 / all
   Opus were Sonnet 5" savings; long sessions where average context > 150K; subagent model mix; average cost
   per prompt by project; idle-gap cache expiries. Each insight: title, one-sentence explanation, money
   impact, affected sessions (links). 4. What-if pricing simulator on the session and overview pages
   (switch model pricing for a view without saving). 5. Exports (CSV, JSON, copy-as-Markdown session
   receipt). 6. Session chains via `continued-in` with chain total. 7. Pins. 8. Live re-index with SSE.
9. Compare two sessions side by side (`/compare?a=&b=`). 10. Keyboard shortcuts (`?` help, `/` search,
   `g o` overview, `g s` sessions, `j/k` rows, `Enter` open, `[`/`]` prev/next turn).

## 11. Testing and quality bar
- `npm run typecheck` clean; `npm test` (vitest) green; `npm run build` clean; `npm run test:e2e` green
  (Playwright against the synthetic fixture root via `CCA_CLAUDE_DIR=tests/fixtures/projects`, plus an axe
  scan of every page with zero serious/critical violations).
- Unit tests must cover: dedup rule (placeholder vs final usage), iterations/fallback billing, `<synthetic>`
  exclusion, cache TTL split, fast/us modifiers, unknown model policy, longest-prefix model matching, title
  priority + cleaning, tool_use↔tool_result↔agent linking (sync + async + workflow), delta vs heuristic
  estimation, carry range stopping at compaction, hook injection rules, attachment rendered-length rule,
  incremental reindex (changed file → rows replaced), search (title trigram + content snippet).
- `scripts/screenshot.ts` captures every page in both themes at 1440×900 into `docs/screenshots/` (used for
  review and the executive summary).

## 12. Working rules for contributors
- Run `npm run typecheck` and `npm test` before opening a pull request; note exactly what passed
  and what didn't in the PR description.
- Do not write to `~/.claude/**` during development or testing; use a scratch `CCA_HOME` instead.

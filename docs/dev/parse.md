# core-parse — JSONL → `ParsedSession`

Owns `core/jsonl.ts`, `core/discover.ts`, `core/parse/**`. Pure TypeScript, no HTTP, no DB, no
pricing: it turns files on disk into the domain objects in `core/types.ts` and stops there.

## Use it

```ts
import { discoverSessionsWithWarnings } from '../core/discover.js';
import { parseSession } from '../core/parse/index.js';

const { sessions, warnings } = await discoverSessionsWithWarnings(['~/.claude/projects']);
for (const discovered of sessions) {
  const parsed = await parseSession(discovered);       // ParsedSession
}
```

`discoverSessions(roots)` is the same thing without the warnings. Roots may contain `~`.

## Signatures

```ts
// core/jsonl.ts
interface JsonlLine extends ByteRange { seq: number; text: string }
function readJsonlLines(path: string): AsyncGenerator<JsonlLine>
function readLineAt(path: string, range: ByteRange): Promise<string>
function readLinesAt(path: string, ranges: ByteRange[]): Promise<string[]>   // opens the file once

// core/discover.ts
interface DiscoveryWarning { path: string; message: string }
function discoverSessions(roots: string[]): Promise<DiscoveredSession[]>
function discoverSessionsWithWarnings(roots: string[]): Promise<{ sessions: DiscoveredSession[]; warnings: DiscoveryWarning[] }>
function expandHome(p: string): string

// core/parse/index.ts
function parseTranscript(file: DiscoveredFile, opts?: { agentId?: string | null }): Promise<ParsedTranscript>
function parseSession(d: DiscoveredSession): Promise<ParsedSession>
function cleanPrompt(text: string): string
function resolveTitle(input: TitleInput): { title: string; source: TitleSource }
function normalizeUsage(usage: Record<string, unknown> | undefined): TokenUsage
function contextTokensOf(u: TokenUsage): number
function splitMcpName(name: string): { mcpServer?: string; mcpTool?: string }
function summarizeToolInput(name: string, input: unknown): string
function previewOf(text: string, n?: number): string
```

## Gotchas when wiring the parser

**Requests are already deduplicated.** One `ParsedRequest` per billed API call. `seq` is the first
line of the message, `lines[]` holds every physical line, `blocks[]` is the merged content in
`apiBlockIndex` order. Never count assistant *lines*.

**`iterations` is present only when there was more than one.** When it is set, bill each iteration
at `iteration.model` and ignore `request.usage` — the top-level usage equals the last iteration
only. When it is absent, bill `request.usage`.

**`usage.assumedTtl`** means the transcript had no `cache_creation` breakdown, so the whole write
sits in `cache5m`. It must be re-bucketed per `PricingConfig.assumeCacheWriteTtlWhenUnknown` before
pricing; the index does that at read time by storing those tokens in `requests.cacheAssumed` rather
than in `cache5m` (see `docs/dev/cost-db.md`). Do not re-bucket at parse time — the parser has no
pricing config, and baking the choice in would make a settings change need a re-index.
(Not seen once in the current real corpus, but older Claude Code versions omit it.)

**`isSynthetic`** requests are kept in the transcript and must be excluded from request counts and
priced at zero. Their `model` is the literal `<synthetic>`.

**Turn 0 is real.** Everything before the first human prompt (session-start hooks, environment
attachments) carries `turnIndex: 0`. The first prompt is turn 1.

**Consecutive prompts share a turn.** A human prompt opens a new turn only when at least one
billed request happened since the current turn started — so a prompt immediately followed by a
skill-expansion user line, or a prompt queued while the model was still idle, stays in the turn
already open. Without that rule the transcript grew empty turns whose header preview repeated the
one above it (106 such prompts across 76 turns on the author's corpus). `promptCount` still counts
every human prompt, so it can now exceed the number of turns; a synthetic assistant message does
not close a turn either, since it was never billed. The only turns left with no request are
trailing ones — a prompt the session never answered.

**`TranscriptMeta.firstPrompt`** is the cleaned first human prompt of *that* transcript, main or
agent. `SessionFacts.firstPrompt` carries the same value for main files; agent transcripts need
their own because the index falls back to it when `meta.json` has no `description`.

**Subagent totals never live in the main transcript.** `ParsedSession.agents` is the complete list
of sub-transcripts: `subagents/agent-*.jsonl`, every workflow agent, *and* legacy embedded
sidechains lifted out of the main file. `main.embeddedAgents` holds the same objects by agent id
for provenance — iterate `agents`, not both, or you will double count.

**`seq` is a file-line index, not a per-transcript counter.** An embedded agent's requests carry
the seq they have in the *main* file, so `(byteOffset, byteLength)` keeps addressing real bytes.

**Injections vs hook runs.** A hook line produces both: a `ParsedHookRun` (duration, exit code,
command) and, when it actually injected text, a `ParsedInjection`. Charge money from the
injections; report time from the hook runs. A `stop_hook_summary` becomes one run per `hookInfos`
entry, and its injected characters are attributed to the **first** of them so nothing is counted
twice.

**`charsSource` tells you how good the char count is:** `rendered` (exact — this is what entered
context), `content` (a known payload field), `json` (unknown attachment shape, JSON size of the
payload minus its `type`), `none` (nothing measurable — treat as `estMethod: 'none'`).
`prompt_snapshot` produces a `system_prompt` injection only when `rendered` is present.

**Attachments are previewable but not searchable.** `ParsedMessage.searchText` is empty for
`attachment` and `system` lines and for `meta` user lines; it is populated for prompts, compact
summaries, interrupts, assistant lines (text + thinking + tool name + input JSON) and tool results.
`preview` is populated for everything.

**Tool calls may be unanswered.** `resultSeq === undefined` and `resultShape === 'missing'` is
normal (aborted turns). `childAgentId` / `childRunId` are links, not guarantees: the referenced
transcript file may not exist on disk (about a third of real `Agent` calls). Check before joining.

**Money is never computed here** and no cost field exists on any parsed object. Cost lives in
`core/cost`. `SessionFacts.reportedCost` is Claude Code's own tally, kept verbatim — model keys
still carry the `[1m]` suffix; strip it at price-match time, not at parse time.

**Discovery never throws.** Unreadable directories, bad JSON in `sessions-index.json` and legacy
agent files with no derivable session all become warnings. A workflow run directory that is a
symlink into *another* session (Claude Code does this when a run is resumed) is skipped with a
warning, so its agents are billed once, to the session that owns them.

**Malformed transcript lines are counted, not fatal.** `meta.parseErrors` per transcript; the line
is skipped and `seq` keeps advancing.

## Performance

Streaming end to end: `readJsonlLines` buffers at most one partial line, so a 23 MB transcript
never lands in memory whole. A full parse of the author's real `~/.claude/projects` (267 MB,
635 transcripts, 477 sessions) takes **~1.7 s** single-threaded with a peak RSS of ~230 MB — well
inside the 60 s budget. Parsing is per-session and independent, so the indexer can shard it.

## Tests

`tests/core/parse/*.test.ts` (92 tests across 9 files). `tests/fixtures/README.md` documents every fixture session
and its hand-computed token and USD totals; `fixture-totals.test.ts` asserts that table, so a
change to the fixture tree fails loudly instead of silently moving other modules' expectations.

/**
 * Synthetic demo dataset generator.
 *
 * Produces a directory shaped exactly like `~/.claude/projects` (SPEC §3.1) so the app can be
 * demoed, screenshotted and recorded without touching anybody's real transcripts. Everything is
 * invented in `core/demo/content.ts`; this file only decides shapes, token counts and timestamps.
 *
 * Two halves, on purpose:
 *  - `buildDemoTree` is pure: same `seed`/`now`/`sessions` in, byte-identical `Map<path, text>`
 *    out. No filesystem, no clock, no `Math.random`.
 *  - `writeDemoTree` / `generateDemoData` are the only things here that touch disk.
 *
 * Cost realism is enforced by generating token counts against the same list prices the app
 * charges (`core/pricing/defaults.ts`), so each session hits a planned dollar target and the
 * `cost-state` oracle lines can be written to agree with what the app will compute.
 */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Rng } from './rng.js';
import {
  AGENT_DESCRIPTIONS,
  AGENT_TYPES,
  DEMO_PROJECTS,
  FOLLOW_UPS,
  HOOK_NAMES,
  MCP_TOOLS,
  PLUGINS,
  PROMPTS,
  SKILLS,
  TITLES,
  WORKFLOW_LENSES,
  filler,
  type DemoProject,
} from './content.js';

// ─────────────────────────────── knobs ───────────────────────────────

export const DEMO_SEED = 20260909;
export const DEMO_SESSION_COUNT = 62;
/** Calendar span the sessions are spread over; the app's default preset is the last 30 days. */
export const DEMO_DAYS = 35;
/** Claude Code version stamped on every envelope. */
const VERSION = '2.1.263';
/** Modern-tokenizer chars per token, matching `PricingConfig` for Claude 4.7+ models. */
const CHARS_PER_TOKEN = 3.1;
/** Context size that triggers an auto-compaction. */
const COMPACT_AT_TOKENS = 184_000;
/** Hard stop so a mis-tuned target can never produce a runaway file. */
const MAX_REQUESTS_PER_SESSION = 1200;

export interface DemoOptions {
  seed?: number;
  /** epoch ms treated as "now"; the newest session lands today so date presets are populated */
  now?: number;
  sessions?: number;
}

export interface DemoSummary {
  projects: number;
  sessions: number;
  files: number;
  requests: number;
  agents: number;
  workflowRuns: number;
  bytes: number;
  totalUsd: number;
  firstDate: string;
  lastDate: string;
}

export interface DemoTree {
  /** path relative to the generated `projects/` root → file contents (always newline-terminated) */
  files: Map<string, string>;
  summary: DemoSummary;
}

// ─────────────────────────────── pricing ───────────────────────────────

type ModelKey = 'opus' | 'sonnet' | 'fable' | 'haiku' | 'opus48';

const MODEL_IDS: Record<ModelKey, string> = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  fable: 'claude-fable-5-1',
  haiku: 'claude-haiku-4-5-20251001',
  opus48: 'claude-opus-4-8',
};

/** `cost-state` reports Opus 5 under its 1M-context alias. */
const REPORTED_MODEL_IDS: Record<ModelKey, string> = {
  ...MODEL_IDS,
  opus: 'claude-opus-5[1m]',
};

interface Rate {
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
}

function rate(input: number, output: number, write5m: number, write1h: number, read: number): Rate {
  return { input, output, write5m, write1h, read };
}

/** USD per million tokens; must stay in step with `core/pricing/defaults.ts`. */
const RATES: Record<ModelKey, Rate> = {
  opus: rate(5, 25, 6.25, 10, 0.5),
  opus48: rate(5, 25, 6.25, 10, 0.5),
  sonnet: rate(2, 10, 2.5, 4, 0.2),
  fable: rate(10, 50, 12.5, 20, 0.25),
  haiku: rate(1, 5, 1.25, 2, 0.1),
};

/** Fast mode on an Opus-class model is billed at the Fable rate card. */
const FAST_RATE = rate(10, 50, 12.5, 20, 1);
const WEB_SEARCH_PER_1000 = 10;

interface Usage {
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cache5m: number;
  cache1h: number;
  webSearch: number;
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, thinking: 0, cacheRead: 0, cache5m: 0, cache1h: 0, webSearch: 0 };
}

/** Per-model running total: tokens plus the dollars they were billed at. */
interface ModelTally {
  usage: Usage;
  usd: number;
}

function addUsage(into: Usage, add: Usage): void {
  into.input += add.input;
  into.output += add.output;
  into.thinking += add.thinking;
  into.cacheRead += add.cacheRead;
  into.cache5m += add.cache5m;
  into.cache1h += add.cache1h;
  into.webSearch += add.webSearch;
}

function usdOf(model: ModelKey, u: Usage, fast: boolean): number {
  const r = fast && (model === 'opus' || model === 'opus48') ? FAST_RATE : RATES[model];
  return (
    (u.input * r.input +
      u.output * r.output +
      u.cache5m * r.write5m +
      u.cache1h * r.write1h +
      u.cacheRead * r.read) /
      1_000_000 +
    (u.webSearch * WEB_SEARCH_PER_1000) / 1000
  );
}

function tokensOfChars(chars: number): number {
  return Math.max(1, Math.round(chars / CHARS_PER_TOKEN));
}

// ─────────────────────────────── plan ───────────────────────────────

type SessionSize = 'small' | 'medium' | 'large';
type Divergence = 'tally-more' | 'file-more' | 'hidden-calls';

interface SessionPlan {
  sessionId: string;
  size: SessionSize;
  model: ModelKey;
  project: DemoProject;
  branch: string;
  title: string;
  prompt: string;
  startMs: number;
  targetUsd: number;
  agents: number;
  workflow: boolean;
  divergence?: Divergence;
  entrypoint: string;
  sessionKind?: string;
  /** one-off features, at most a handful of sessions each */
  fast: boolean;
  fallback: boolean;
  webSearch: boolean;
  image: boolean;
  prLink: boolean;
  continuedIn: boolean;
  customTitleFile: boolean;
  customTitleLine: boolean;
  awaySummary: boolean;
  apiError: boolean;
  continuedInSessionId?: string;
}

/** Session-count split and the dollar band each band is drawn from. */
const SIZE_SHARES: Record<SessionSize, number> = { large: 0.26, medium: 0.19, small: 0.55 };

/** Model quotas per size band, as a share of that band's sessions. */
const MODEL_SHARES: Record<SessionSize, [ModelKey, number][]> = {
  large: [
    ['opus', 0.85],
    ['sonnet', 0.09],
    ['fable', 0.06],
  ],
  medium: [
    ['opus', 0.5],
    ['sonnet', 0.18],
    ['fable', 0.2],
    ['haiku', 0.12],
  ],
  small: [
    ['opus', 0.48],
    ['sonnet', 0.28],
    ['fable', 0.14],
    ['haiku', 0.1],
  ],
};

function quotas(count: number, shares: [ModelKey, number][]): ModelKey[] {
  const out: ModelKey[] = [];
  for (const [model, share] of shares) {
    for (let i = 0; i < Math.round(count * share); i += 1) out.push(model);
  }
  while (out.length > count) out.pop();
  const first = shares[0]?.[0] ?? 'opus';
  while (out.length < count) out.push(first);
  return out;
}

/**
 * Room a session needs to finish before `now`. Small sessions run a few hours at most; medium and
 * large ones ride idle gaps for a day or two, so they are kept off the most recent days entirely
 * (see `EARLIEST_DAY_OFFSET`) and only small ones may land today.
 */
const SESSION_BUDGET_MS: Record<SessionSize, number> = {
  large: 5 * 3_600_000,
  medium: 5 * 3_600_000,
  small: 5 * 3_600_000,
};
/** Days back a session of each size must start, so its idle gaps cannot carry it past `now`. */
const EARLIEST_DAY_OFFSET: Record<SessionSize, number> = { large: 4, medium: 3, small: 0 };

/**
 * Local midnight `dayOffset` days before `now`, then a plausible working hour — never in the
 * future, and early enough that the session can end before `now`. Today's slot keeps a session
 * if a working hour still fits; otherwise it slides to the previous day.
 */
function startOfSession(now: number, dayOffset: number, rng: Rng, budgetMs: number): number {
  const base = new Date(now - dayOffset * 86_400_000);
  const midnight = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
  const hour = rng.int(8, 19);
  const minute = rng.int(0, 59);
  let start = midnight + hour * 3_600_000 + minute * 60_000;
  const latest = now - budgetMs;
  if (start > latest) {
    const latestHour = Math.floor((latest - midnight) / 3_600_000);
    start = latestHour >= 8 ? Math.min(start, latest) : start - 86_400_000;
  }
  return start;
}

function dateKey(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Deals sessions to projects. Every project gets one session first — otherwise a small
 * `--sessions` run can miss the worktree or the scratch project entirely and the demo loses the
 * two cases the UI treats specially — and the rest come from a weighted, shuffled bag.
 */
function projectPicker(rng: Rng): () => DemoProject {
  const bag: DemoProject[] = [];
  for (const project of DEMO_PROJECTS) {
    for (let i = 0; i < project.weight; i += 1) bag.push(project);
  }
  const queue = [...rng.shuffled(DEMO_PROJECTS), ...rng.shuffled(bag)];
  let at = 0;
  return () => {
    const project = queue[at % queue.length];
    at += 1;
    return project ?? DEMO_PROJECTS[0]!;
  };
}

/** Hands out each project's titles/prompts without repeating one until the pool is exhausted. */
class TextPool {
  private readonly used = new Map<string, number>();

  constructor(private readonly rng: Rng) {}

  take(slug: string, pool: Record<string, string[]>, fallback: string): string {
    const list = pool[slug] ?? [];
    if (list.length === 0) return fallback;
    const at = this.used.get(`${slug}:${fallback}`) ?? 0;
    this.used.set(`${slug}:${fallback}`, at + 1);
    const value = list[at % list.length];
    if (at < list.length) return value ?? fallback;
    return `${value ?? fallback} (part ${Math.floor(at / list.length) + 1})`;
  }

  followUp(): string {
    return this.rng.pick(FOLLOW_UPS);
  }
}

function buildPlans(rng: Rng, now: number, sessions: number): SessionPlan[] {
  const large = Math.max(3, Math.round(sessions * SIZE_SHARES.large));
  const medium = Math.max(2, Math.round(sessions * SIZE_SHARES.medium));
  const small = Math.max(1, sessions - large - medium);
  const sizes: SessionSize[] = [
    ...Array.from({ length: large }, (): SessionSize => 'large'),
    ...Array.from({ length: medium }, (): SessionSize => 'medium'),
    ...Array.from({ length: small }, (): SessionSize => 'small'),
  ];
  const models: Record<SessionSize, ModelKey[]> = {
    large: quotas(large, MODEL_SHARES.large),
    medium: quotas(medium, MODEL_SHARES.medium),
    small: quotas(small, MODEL_SHARES.small),
  };
  const modelAt: Record<SessionSize, number> = { large: 0, medium: 0, small: 0 };
  const nextProject = projectPicker(rng);
  const pool = new TextPool(rng);
  // The last fortnight gets at least one session per day so the 7- and 14-day presets never
  // show a hole; everything else is drawn with a recency bias over the whole span.
  const dense = Math.min(sizes.length, 14);
  const offsets = rng.shuffled([
    ...Array.from({ length: dense }, (_unused, i) => i),
    ...Array.from({ length: sizes.length - dense }, () =>
      Math.min(DEMO_DAYS - 1, Math.floor(Math.pow(rng.unit(), 1.35) * DEMO_DAYS)),
    ),
  ]);
  let offsetAt = 0;

  const plans: SessionPlan[] = [];
  for (const size of sizes) {
    const project = nextProject();
    const model = models[size][modelAt[size]] ?? 'opus';
    modelAt[size] += 1;
    const drawnOffset = offsets[offsetAt] ?? 0;
    offsetAt += 1;
    const floor = EARLIEST_DAY_OFFSET[size];
    const dayOffset = drawnOffset < floor ? drawnOffset + floor : drawnOffset;
    const targetUsd =
      size === 'large'
        ? rng.float(30, 88)
        : size === 'medium'
          ? rng.float(4.5, 20)
          : rng.logNormal(1.05, 0.85, 0.18, 3.4);
    plans.push({
      sessionId: rng.uuid(),
      size,
      model,
      project,
      branch: rng.pick(project.branches),
      title: pool.take(project.slug, TITLES, 'Session work'),
      prompt: pool.take(project.slug, PROMPTS, 'Have a look at the failing test and fix it.'),
      startMs: startOfSession(now, dayOffset, rng, SESSION_BUDGET_MS[size]),
      targetUsd,
      agents: size === 'large' ? rng.int(2, 4) : size === 'medium' && rng.chance(0.35) ? 1 : 0,
      workflow: false,
      entrypoint: rng.chance(0.08) ? 'claude-desktop' : rng.chance(0.04) ? 'sdk-cli' : 'cli',
      fast: false,
      fallback: false,
      webSearch: false,
      image: false,
      prLink: false,
      continuedIn: false,
      customTitleFile: false,
      customTitleLine: false,
      awaySummary: rng.chance(0.08),
      apiError: false,
    });
  }

  plans.sort((a, b) => a.startMs - b.startMs);

  const larges = plans.filter((p) => p.size === 'large');
  const mids = plans.filter((p) => p.size === 'medium');
  const smalls = plans.filter((p) => p.size === 'small');
  const at = <T>(list: T[], i: number): T | undefined => list[i % Math.max(1, list.length)];

  // One-off features, pinned to specific sessions so the dataset always contains exactly one of
  // each thing a demo needs to show.
  const wf1 = at(larges, 1);
  const wf2 = at(larges, larges.length - 2);
  if (wf1) wf1.workflow = true;
  if (wf2 && wf2 !== wf1) wf2.workflow = true;
  const fastSession = at(larges, 0);
  if (fastSession) fastSession.fast = true;
  const fallbackSession = at(mids, 0);
  if (fallbackSession) {
    fallbackSession.fallback = true;
    fallbackSession.model = 'fable';
  }
  const searchSession = at(mids, 1);
  if (searchSession) searchSession.webSearch = true;
  const imageSession = at(larges, 2);
  if (imageSession) imageSession.image = true;
  const prSession = at(larges, 3);
  if (prSession) prSession.prLink = true;
  const continued = at(smalls, 0);
  if (continued) {
    continued.continuedIn = true;
    const successor = plans.find((p) => p.startMs > continued.startMs && p !== continued);
    if (successor) continued.continuedInSessionId = successor.sessionId;
  }
  for (const i of [0, 1]) {
    const s = at(larges, 4 + i);
    if (s) s.customTitleFile = true;
  }
  for (const i of [0, 1, 2]) {
    const s = at(mids, 2 + i);
    if (s) s.customTitleLine = true;
  }
  for (const i of [0, 1]) {
    const s = at(smalls, 3 + i);
    if (s) s.apiError = true;
  }
  const errLarge = at(larges, 5);
  if (errLarge) errLarge.apiError = true;

  const tallyMore = at(mids, mids.length - 1);
  if (tallyMore) tallyMore.divergence = 'tally-more';
  const fileMore = at(mids, mids.length - 2);
  if (fileMore && fileMore !== tallyMore) fileMore.divergence = 'file-more';
  const hidden = at(smalls, smalls.length - 2);
  if (hidden) {
    hidden.divergence = 'hidden-calls';
    hidden.agents = 0;
  }
  const bg = at(smalls, 6);
  if (bg) bg.sessionKind = 'bg';

  return plans;
}

// ─────────────────────────────── transcript writer ───────────────────────────────

interface Envelope {
  sessionId: string;
  cwd: string;
  gitBranch: string;
  entrypoint: string;
  sessionKind?: string;
  agentId?: string;
  isSidechain?: boolean;
}

/** Accumulates the JSONL lines of one transcript file. */
class Lines {
  readonly out: string[] = [];

  constructor(
    private readonly env: Envelope,
    private readonly rng: Rng,
  ) {}

  get length(): number {
    return this.out.length;
  }

  /** Adds the shared envelope (SPEC §3.2) and appends the line. */
  push(ts: number, body: Record<string, unknown>): void {
    const line: Record<string, unknown> = {
      parentUuid: null,
      isSidechain: this.env.isSidechain ?? false,
      ...body,
      uuid: this.rng.uuid(),
      timestamp: new Date(ts).toISOString(),
      sessionId: this.env.sessionId,
      cwd: this.env.cwd,
      version: VERSION,
      gitBranch: this.env.gitBranch,
      userType: 'external',
      entrypoint: this.env.entrypoint,
    };
    if (this.env.sessionKind) line.sessionKind = this.env.sessionKind;
    if (this.env.agentId) line.agentId = this.env.agentId;
    this.out.push(JSON.stringify(line));
  }

  /** Fact lines (`ai-title`, `cost-state`, …) carry no envelope beyond the session id. */
  pushBare(body: Record<string, unknown>): void {
    this.out.push(JSON.stringify({ ...body, sessionId: this.env.sessionId }));
  }

  text(): string {
    return `${this.out.join('\n')}\n`;
  }
}

interface Block {
  type: 'thinking' | 'text' | 'tool_use' | 'fallback';
  thinking?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  from?: { model: string };
  to?: { model: string };
}

interface RequestSpec {
  model: ModelKey;
  /** cold means the whole context is re-written (session start, post-compaction, cache expiry) */
  cold: boolean;
  /** tokens that entered the context since the previous request */
  added: number;
  output: number;
  thinking: number;
  blocks: Block[];
  stopReason: string;
  fast?: boolean;
  webSearch?: number;
  oneHourWrite?: boolean;
  fallback?: boolean;
  effort?: string;
  attribution?: Record<string, string>;
}

interface RequestResult {
  usage: Usage;
  usd: number;
  model: ModelKey;
}

const TEXT_SNIPPETS = [
  'Reading the handler first.',
  'That confirms the ordering problem.',
  'Patching the guard and re-running.',
  'The failure is in the retry path, not the queue.',
  'Two call sites need the same change.',
  'Running the focused test now.',
  'Here is the smallest fix that keeps the contract.',
  'Checking whether the sibling module has the same bug.',
  'The profile points at the allocation in the inner loop.',
  'Writing the test before the fix so it fails first.',
];

const THINK_SNIPPETS = [
  'The failing assertion is about ordering, so the queue is probably draining before the ack.',
  'If the budget is per-call the amplification stays; it has to be per-window.',
  'Cheaper to read the caller than to guess at the contract here.',
  'Two candidates: the cursor is stale, or the row was deleted between pages.',
  'The scalar path wins because the SIMD version reloads the mask every iteration.',
];

/** One transcript (main or agent) being generated, with its running context and cost. */
class Transcript {
  readonly lines: Lines;
  /** context tokens carried into the next request */
  ctx: number;
  usd = 0;
  requests = 0;
  compactions = 0;
  readonly usageByModel = new Map<ModelKey, ModelTally>();
  private ts: number;
  private msgSeq = 0;

  constructor(
    private readonly env: Envelope,
    private readonly rng: Rng,
    startMs: number,
    baseContext: number,
  ) {
    this.lines = new Lines(env, rng);
    this.ts = startMs;
    this.ctx = baseContext;
  }

  get now(): number {
    return this.ts;
  }

  advance(ms: number): number {
    this.ts += ms;
    return this.ts;
  }

  private nextMessageId(): string {
    this.msgSeq += 1;
    return `msg_${this.env.sessionId.slice(0, 8)}${this.env.agentId ? `_${this.env.agentId.slice(0, 4)}` : ''}_${this.msgSeq}`;
  }

  attachment(type: string, payload: Record<string, unknown>, rendered?: string): void {
    const body: Record<string, unknown> = { attachment: { type, ...payload }, type: 'attachment' };
    if (rendered !== undefined) body.rendered = [{ content: rendered }];
    this.lines.push(this.advance(this.rng.int(200, 1200)), body);
  }

  hookSuccess(index: number, stdout: string, exitCode = 0): void {
    const hook = HOOK_NAMES[index % HOOK_NAMES.length];
    if (!hook) return;
    this.attachment('hook_success', {
      hookName: hook.hookName,
      hookEvent: hook.hookEvent,
      toolUseID: this.rng.uuid(),
      content: '',
      stdout: exitCode === 0 ? stdout : '',
      stderr: exitCode === 0 ? '' : 'hook exited non-zero',
      exitCode,
      command: hook.command,
      durationMs: this.rng.int(18, 640),
    });
  }

  prompt(text: string, opts: { image?: boolean } = {}): number {
    const content: unknown = opts.image
      ? [
          { type: 'text', text },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
        ]
      : text;
    this.lines.push(this.advance(this.rng.int(1500, 40_000)), {
      type: 'user',
      message: { role: 'user', content },
    });
    return tokensOfChars(text.length);
  }

  /** Emits one billed request as one, two or three physical lines (SPEC §3.3 dedup rules). */
  request(spec: RequestSpec): RequestResult {
    const messageId = this.nextMessageId();
    const requestId = `req_${messageId.slice(4)}`;
    const usage = emptyUsage();
    usage.input = this.rng.int(2, 11);
    usage.output = spec.output;
    usage.thinking = spec.thinking;
    usage.webSearch = spec.webSearch ?? 0;
    if (spec.cold) {
      const write = this.ctx + spec.added;
      if (spec.oneHourWrite) usage.cache1h = write;
      else usage.cache5m = write;
    } else {
      usage.cacheRead = this.ctx;
      if (spec.oneHourWrite) usage.cache1h = spec.added;
      else usage.cache5m = spec.added;
    }
    this.ctx = usage.input + usage.cacheRead + usage.cache5m + usage.cache1h + usage.output;

    const fast = spec.fast === true;
    let usd = 0;
    let iterations: Record<string, unknown>[];
    if (spec.fallback) {
      // A fallback splits the bill: the first attempt on the requested model, the retry on the
      // model it fell back to. Top-level usage equals the last iteration only.
      const firstUsage: Usage = { ...emptyUsage(), input: 2, output: Math.round(spec.output * 0.2), cacheRead: this.ctx };
      iterations = [
        { ...usageJson(firstUsage), type: 'message', model: MODEL_IDS.fable },
        { ...usageJson(usage), type: 'fallback_message', model: MODEL_IDS.opus48 },
      ];
      const firstUsd = usdOf('fable', firstUsage, false);
      const secondUsd = usdOf('opus48', usage, false);
      usd = firstUsd + secondUsd;
      this.addModelUsage('fable', firstUsage, firstUsd);
      this.addModelUsage('opus48', usage, secondUsd);
    } else {
      iterations = [{ ...usageJson(usage), type: 'message' }];
      usd = usdOf(spec.model, usage, fast);
      this.addModelUsage(spec.model, usage, usd);
    }
    this.usd += usd;
    this.requests += 1;

    const model = spec.fallback ? MODEL_IDS.opus48 : MODEL_IDS[spec.model];
    const usageBlock = {
      ...usageJson(usage),
      output_tokens_details: { thinking_tokens: usage.thinking },
      server_tool_use: { web_search_requests: usage.webSearch, web_fetch_requests: 0 },
      service_tier: 'standard',
      inference_geo: 'global',
      speed: fast ? 'fast' : 'standard',
      iterations,
    };
    const placeholderUsage = { ...usageBlock, output_tokens: 5, output_tokens_details: { thinking_tokens: 0 } };

    const extra: Record<string, unknown> = {};
    if (spec.effort) extra.effort = spec.effort;
    for (const [key, value] of Object.entries(spec.attribution ?? {})) extra[key] = value;

    const line = (content: Block[], u: Record<string, unknown>, apiBlockIndex?: number): void => {
      const body: Record<string, unknown> = {
        message: {
          model,
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: content.map(blockJson),
          stop_reason: spec.stopReason,
          stop_sequence: null,
          usage: u,
        },
        requestId,
        type: 'assistant',
        ...extra,
      };
      if (apiBlockIndex !== undefined) body.apiBlockIndex = apiBlockIndex;
      this.lines.push(this.advance(this.rng.int(900, 26_000)), body);
    };

    const style = this.rng.unit();
    const first = spec.blocks[0];
    if (spec.blocks.length >= 3 && style < 0.06) {
      // Block-per-line with `apiBlockIndex` recorded out of order.
      const order = [0, 2, 1];
      spec.blocks.forEach((_, i) => {
        const at = order[i] ?? i;
        const block = spec.blocks[at];
        if (block) line([block], i === 0 ? placeholderUsage : usageBlock, at);
      });
    } else if (spec.blocks.length >= 2 && style < 0.22 && first) {
      // Streaming placeholder followed by the final count.
      line([first], placeholderUsage);
      line(spec.blocks.slice(1), usageBlock);
    } else {
      line(spec.blocks, usageBlock);
    }
    return { usage, usd, model: spec.fallback ? 'opus48' : spec.model };
  }

  addModelUsage(model: ModelKey, usage: Usage, usd: number): void {
    const existing = this.usageByModel.get(model);
    if (existing) {
      addUsage(existing.usage, usage);
      existing.usd += usd;
    } else {
      this.usageByModel.set(model, { usage: { ...usage }, usd });
    }
  }

  /** A synthetic, zero-cost client-side message (SPEC §3.3). */
  synthetic(text: string): void {
    this.lines.push(this.advance(this.rng.int(400, 2000)), {
      type: 'assistant',
      message: {
        id: `msg_syn_${this.rng.hex(8)}`,
        model: '<synthetic>',
        role: 'assistant',
        type: 'message',
        stop_reason: 'stop_sequence',
        content: [{ type: 'text', text }],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens_details: null,
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          service_tier: null,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          inference_geo: null,
          iterations: null,
          speed: null,
        },
      },
      isApiErrorMessage: true,
    });
  }

  toolResult(
    toolUseId: string,
    result: { text?: string; blocks?: unknown[]; isError?: boolean },
    toolUseResult?: unknown,
  ): void {
    const content: unknown[] = [
      {
        tool_use_id: toolUseId,
        type: 'tool_result',
        ...(result.blocks ? { content: result.blocks } : { content: result.text ?? '' }),
        ...(result.isError ? { is_error: true } : {}),
      },
    ];
    const body: Record<string, unknown> = {
      promptId: this.rng.uuid(),
      type: 'user',
      message: { role: 'user', content },
    };
    if (toolUseResult !== undefined) body.toolUseResult = toolUseResult;
    this.lines.push(this.advance(this.rng.int(300, 9000)), body);
  }

  system(subtype: string, extra: Record<string, unknown>): void {
    this.lines.push(this.advance(this.rng.int(200, 1500)), { type: 'system', subtype, ...extra });
  }

  stopHooks(): void {
    const injected = this.rng.chance(0.45);
    this.system('stop_hook_summary', {
      hookCount: 2,
      hookInfos: [
        { command: './scripts/format-on-edit.sh', durationMs: this.rng.int(40, 900) },
        { command: './scripts/notify-stop.sh', durationMs: this.rng.int(10, 120) },
      ],
      hookErrors: [],
      hookAdditionalContext: injected ? [filler(this.rng.int(120, 700), this.rng.int(1, 1e9), 'prose')] : [],
      preventedContinuation: false,
      level: 'suggestion',
    });
  }

  compact(preTokens: number): number {
    const postTokens = this.rng.int(16_000, 28_000);
    this.system('compact_boundary', {
      content: 'Conversation compacted',
      level: 'info',
      compactMetadata: {
        trigger: this.rng.chance(0.8) ? 'auto' : 'manual',
        preTokens,
        postTokens,
        cumulativeDroppedTokens: preTokens - postTokens,
        durationMs: this.rng.int(4000, 14_000),
      },
    });
    const summary = filler(Math.round(postTokens * CHARS_PER_TOKEN * 0.06), this.rng.int(1, 1e9), 'prose');
    this.lines.push(this.advance(this.rng.int(500, 3000)), {
      promptId: this.rng.uuid(),
      type: 'user',
      isCompactSummary: true,
      message: {
        role: 'user',
        content: `This session is being continued from a previous conversation that ran out of context.\n\nSummary:\n${summary}`,
      },
    });
    this.compactions += 1;
    this.ctx = postTokens;
    return postTokens;
  }
}

function usageJson(u: Usage): Record<string, unknown> {
  return {
    input_tokens: u.input,
    cache_creation_input_tokens: u.cache5m + u.cache1h,
    cache_read_input_tokens: u.cacheRead,
    output_tokens: u.output,
    cache_creation: { ephemeral_1h_input_tokens: u.cache1h, ephemeral_5m_input_tokens: u.cache5m },
  };
}

function blockJson(block: Block): Record<string, unknown> {
  switch (block.type) {
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking ?? '', signature: 'sig-demo' };
    case 'text':
      return { type: 'text', text: block.text ?? '' };
    case 'tool_use':
      return { type: 'tool_use', id: block.id ?? '', name: block.name ?? '', input: block.input ?? {} };
    default:
      return { type: 'fallback', from: block.from ?? { model: '' }, to: block.to ?? { model: '' } };
  }
}

// ─────────────────────────────── tool calls ───────────────────────────────

interface ToolPlan {
  name: string;
  input: Record<string, unknown>;
  /** tokens the result adds to the context; the result text is sized to match */
  resultTokens: number;
  isError: boolean;
  image?: boolean;
}

const SOURCE_FILES = [
  'src/payments/worker.ts',
  'src/payments/retry.ts',
  'src/ledger/reader.ts',
  'src/webhooks/verify.ts',
  'src/http/rate-limit.ts',
  'src/usage/aggregate.ts',
  'src/db/cursor.ts',
  'tests/payments/retry.test.ts',
  'index/quantize.rs',
  'bench/harness.rs',
  'web/src/panels/Usage.tsx',
  'infra/modules/ingress/main.tf',
];

const BASH_COMMANDS = [
  'npm test -- payments/retry',
  'npm run typecheck',
  'git diff --stat',
  'rg -n "idempotency" src | head -40',
  'cargo bench --bench topk',
  'terraform plan -no-color',
  'npm run build',
  'node scripts/replay-webhook.mjs --dry-run',
];

const GREP_PATTERNS = ['idempotencyKey', 'retryBudget', 'cursor', 'tenantId', 'recall@10', 'evict'];

function pickTool(rng: Rng, project: DemoProject, opts: { webSearch?: boolean; image?: boolean } = {}): ToolPlan {
  if (opts.image) {
    return {
      name: 'Read',
      input: { file_path: `${project.cwd}/docs/usage-panel.png` },
      resultTokens: 1600,
      isError: false,
      image: true,
    };
  }
  if (opts.webSearch) {
    return {
      name: 'WebSearch',
      input: { query: 'idempotency key collision across tenants best practice' },
      resultTokens: rng.int(500, 1200),
      isError: false,
    };
  }
  const roll = rng.unit();
  const file = `${project.cwd}/${rng.pick(SOURCE_FILES)}`;
  if (roll < 0.26) return { name: 'Read', input: { file_path: file }, resultTokens: rng.int(100, 700), isError: false };
  if (roll < 0.46) {
    return {
      name: 'Bash',
      input: { command: rng.pick(BASH_COMMANDS), description: 'Run the focused check' },
      resultTokens: rng.int(40, 300),
      isError: rng.chance(0.08),
    };
  }
  if (roll < 0.62) {
    return {
      name: 'Edit',
      input: { file_path: file, old_string: 'retryBudget', new_string: 'retryBudgetPerWindow' },
      resultTokens: rng.int(12, 45),
      isError: false,
    };
  }
  if (roll < 0.73) {
    return {
      name: 'Grep',
      input: { pattern: rng.pick(GREP_PATTERNS), output_mode: 'content', '-n': true },
      resultTokens: rng.int(40, 350),
      isError: false,
    };
  }
  if (roll < 0.79) {
    return { name: 'Glob', input: { pattern: 'src/**/*.ts' }, resultTokens: rng.int(40, 260), isError: false };
  }
  if (roll < 0.85) {
    return {
      name: 'Write',
      input: { file_path: `${project.cwd}/tests/payments/retry-budget.test.ts`, content: filler(rng.int(200, 600), rng.int(1, 1e9)) },
      resultTokens: rng.int(15, 40),
      isError: false,
    };
  }
  if (roll < 0.9) {
    return { name: 'Skill', input: { skill: rng.pick(SKILLS) }, resultTokens: rng.int(200, 700), isError: false };
  }
  if (roll < 0.95) {
    return {
      name: 'WebFetch',
      input: { url: 'https://docs.example.dev/idempotency', prompt: 'How should retries reuse the key?' },
      resultTokens: rng.int(200, 700),
      isError: false,
    };
  }
  const mcp = rng.pick(MCP_TOOLS);
  const input = mcp.includes('github')
    ? { repo: 'lumen/lumen-api', state: 'open' }
    : { query: 'retry budget', team: 'platform' };
  return { name: mcp, input, resultTokens: rng.int(120, 450), isError: false };
}

/** Mid-turn harness attachments: `[type, payload builder]`, drawn a few times per session. */
function harnessAttachment(t: Transcript, rng: Rng, project: DemoProject): number {
  const salt = rng.int(1, 1_000_000_000);
  const roll = rng.unit();
  if (roll < 0.2) {
    const text = `<total_tokens>${rng.int(20, 180) * 1000} tokens left</total_tokens>`;
    t.attachment('total_tokens_reminder', { text });
    return tokensOfChars(text.length);
  }
  if (roll < 0.33) {
    const snippet = filler(rng.int(300, 1600), salt);
    t.attachment('edited_text_file', { snippet, filePath: `${project.cwd}/${SOURCE_FILES[salt % SOURCE_FILES.length]}` });
    return tokensOfChars(snippet.length);
  }
  if (roll < 0.44) {
    const content = filler(rng.int(200, 900), salt, 'prose');
    t.attachment('task_reminder', { content: [content], itemCount: 1 });
    return tokensOfChars(content.length);
  }
  if (roll < 0.54) {
    const content = SKILLS.map((s) => `- ${s}: project skill.`).join('\n');
    t.attachment('skill_listing', { content }, `<system-reminder>\n${content}\n</system-reminder>`);
    return tokensOfChars(content.length + 40);
  }
  if (roll < 0.62) {
    const addedLines = [`- ${rng.pick(AGENT_TYPES)}: available in this project.`];
    t.attachment('agent_listing_delta', { addedLines });
    return tokensOfChars(addedLines.join('\n').length);
  }
  if (roll < 0.7) {
    const addedBlocks = [`## github\nRead-only pull request tools for ${project.slug}.`];
    t.attachment('mcp_instructions_delta', { addedBlocks });
    return tokensOfChars(addedBlocks.join('\n').length);
  }
  if (roll < 0.77) {
    const content = filler(rng.int(400, 1200), salt, 'prose');
    t.attachment('sandbox_instructions', { content });
    return tokensOfChars(content.length);
  }
  if (roll < 0.83) {
    t.attachment('read_truncation_notice', { lines: rng.int(2000, 9000), filePath: `${project.cwd}/logs/replay.log` });
    return rng.int(20, 60);
  }
  if (roll < 0.87) {
    const content = filler(rng.int(600, 2600), salt);
    t.attachment('file', { content: { file: { content, filePath: `${project.cwd}/README.md` } } });
    return tokensOfChars(content.length);
  }
  if (roll < 0.9) {
    t.attachment('date_change', { date: dateKey(t.now) });
    return 12;
  }
  if (roll < 0.93) {
    const prompt = 'And then push the branch.';
    t.attachment('queued_command', { prompt });
    return tokensOfChars(prompt.length);
  }
  if (roll < 0.96) {
    t.attachment('invoked_skills', { skills: [rng.pick(SKILLS)] });
    return 18;
  }
  if (roll < 0.98) {
    t.attachment('deferred_tools_delta', { addedLines: MCP_TOOLS.map((m) => `- ${m}`) });
    return tokensOfChars(MCP_TOOLS.join('').length + 8);
  }
  // Deliberately unknown to the parser: exercises the `json` chars fallback.
  t.attachment('workflow_keyword_request', { keyword: 'review', requestedBy: 'harness' });
  return 14;
}

function outputFor(model: ModelKey, rng: Rng): { output: number; thinking: number } {
  const output =
    model === 'opus' || model === 'opus48'
      ? rng.int(1500, 7000)
      : model === 'fable'
        ? rng.int(1200, 5000)
        : model === 'sonnet'
          ? rng.int(1200, 4500)
          : rng.int(600, 3000);
  const thinks = model === 'haiku' ? 0 : model === 'sonnet' ? 0.4 : 0.62;
  const thinking = rng.chance(thinks) ? Math.round(output * rng.float(0.3, 0.75)) : 0;
  return { output, thinking };
}

// ─────────────────────────────── agents ───────────────────────────────

interface AgentSpec {
  agentId: string;
  agentType: string;
  description: string;
  model: ModelKey;
  targetUsd: number;
  toolUseId: string;
  parentAgentId?: string;
  spawnDepth: number;
  /** relative directory the transcript and meta live in */
  dir: string;
  startMs: number;
  /** a nested Agent call this agent makes itself */
  nested?: Omit<AgentSpec, 'dir' | 'startMs'>;
}

interface AgentOutput {
  files: { relPath: string; text: string }[];
  usd: number;
  requests: number;
  agents: number;
  usageByModel: Map<ModelKey, ModelTally>;
  resultText: string;
  durationMs: number;
  lastUsage: Usage;
}

function buildAgent(spec: AgentSpec, plan: SessionPlan, rng: Rng): AgentOutput {
  const env: Envelope = {
    sessionId: plan.sessionId,
    cwd: plan.project.cwd,
    gitBranch: plan.branch,
    entrypoint: plan.entrypoint,
    agentId: spec.agentId,
    isSidechain: true,
    ...(plan.sessionKind ? { sessionKind: plan.sessionKind } : {}),
  };
  const t = new Transcript(env, rng, spec.startMs, rng.int(14_000, 30_000));
  const out: AgentOutput = {
    files: [],
    usd: 0,
    requests: 0,
    agents: 1,
    usageByModel: new Map<ModelKey, ModelTally>(),
    resultText: '',
    durationMs: 0,
    lastUsage: emptyUsage(),
  };

  t.lines.push(t.advance(500), {
    type: 'user',
    message: { role: 'user', content: `${spec.description}. ${filler(rng.int(200, 700), rng.int(1, 1e9), 'prose')}` },
  });
  t.lines.pushBare({ type: 'agent-name', agentName: spec.description });

  let added = 0;
  let cold = true;
  const maxRequests = 260;
  let nestedDone = spec.nested === undefined;
  while (t.usd < spec.targetUsd && t.requests < maxRequests) {
    const spawnNested = !nestedDone && t.requests >= 2;
    const tool: ToolPlan = spawnNested
      ? {
          name: 'Agent',
          input: {
            description: spec.nested?.description ?? 'Nested lookup',
            prompt: 'Find every caller and report back.',
            subagent_type: spec.nested?.agentType ?? 'general-purpose',
          },
          resultTokens: rng.int(300, 900),
          isError: false,
        }
      : pickTool(rng, plan.project);
    const { output, thinking } = outputFor(spec.model, rng);
    const blocks: Block[] = [];
    if (thinking > 0) blocks.push({ type: 'thinking', thinking: rng.pick(THINK_SNIPPETS) });
    blocks.push({ type: 'text', text: rng.pick(TEXT_SNIPPETS) });
    const toolUseId = `toolu_${rng.hex(12)}`;
    blocks.push({ type: 'tool_use', id: toolUseId, name: tool.name, input: tool.input });
    const result = t.request({
      model: spec.model,
      cold,
      added,
      output,
      thinking,
      blocks,
      stopReason: 'tool_use',
    });
    out.lastUsage = result.usage;
    cold = false;
    added = 0;

    if (spawnNested && spec.nested) {
      const nested = buildAgent(
        { ...spec.nested, toolUseId, dir: spec.dir, startMs: t.now },
        plan,
        rng,
      );
      out.files.push(...nested.files);
      out.usd += nested.usd;
      out.requests += nested.requests;
      out.agents += nested.agents;
      mergeUsage(out.usageByModel, nested.usageByModel);
      t.toolResult(toolUseId, { text: nested.resultText }, {
        status: 'completed',
        prompt: 'Find every caller and report back.',
        agentId: spec.nested.agentId,
        agentType: spec.nested.agentType,
        content: [{ type: 'text', text: nested.resultText }],
        totalDurationMs: nested.durationMs,
        totalTokens: nested.lastUsage.output + nested.lastUsage.cache5m,
        totalToolUseCount: nested.requests,
        usage: usageJson(nested.lastUsage),
      });
      nestedDone = true;
      added = tokensOfChars(nested.resultText.length);
      continue;
    }

    const resultText = filler(Math.round(tool.resultTokens * CHARS_PER_TOKEN), rng.int(1, 1e9));
    t.toolResult(toolUseId, { text: resultText, ...(tool.isError ? { isError: true } : {}) });
    added = tool.resultTokens;
  }

  // Closing message: what the parent reads back.
  const summary = `${spec.description}: ${filler(rng.int(240, 900), rng.int(1, 1e9), 'prose')}`;
  const { output, thinking } = outputFor(spec.model, rng);
  const final = t.request({
    model: spec.model,
    cold: false,
    added,
    output,
    thinking,
    blocks: [{ type: 'text', text: summary }],
    stopReason: 'end_turn',
  });
  out.lastUsage = final.usage;
  out.resultText = summary;
  out.usd += t.usd;
  out.requests += t.requests;
  mergeUsage(out.usageByModel, t.usageByModel);
  out.durationMs = t.now - spec.startMs;
  out.files.push(
    { relPath: `${spec.dir}/agent-${spec.agentId}.jsonl`, text: t.lines.text() },
    {
      relPath: `${spec.dir}/agent-${spec.agentId}.meta.json`,
      text: `${JSON.stringify({
        agentType: spec.agentType,
        description: spec.description,
        toolUseId: spec.toolUseId,
        ...(spec.parentAgentId ? { parentAgentId: spec.parentAgentId } : {}),
        spawnDepth: spec.spawnDepth,
        model: agentModelLabel(spec.model),
      })}\n`,
    },
  );
  return out;
}

function agentModelLabel(model: ModelKey): string {
  return model === 'haiku' ? 'haiku' : model === 'sonnet' ? 'sonnet' : model === 'fable' ? 'fable' : 'opus';
}

function mergeUsage(into: Map<ModelKey, ModelTally>, from: Map<ModelKey, ModelTally>): void {
  for (const [model, tally] of from) {
    const existing = into.get(model);
    if (existing) {
      addUsage(existing.usage, tally.usage);
      existing.usd += tally.usd;
    } else {
      into.set(model, { usage: { ...tally.usage }, usd: tally.usd });
    }
  }
}

// ─────────────────────────────── one session ───────────────────────────────

interface SessionOutput {
  files: { relPath: string; text: string }[];
  usd: number;
  requests: number;
  agents: number;
  workflowRuns: number;
  compactions: number;
  endMs: number;
  lineCount: number;
}

function buildSession(plan: SessionPlan, rng: Rng): SessionOutput {
  const env: Envelope = {
    sessionId: plan.sessionId,
    cwd: plan.project.cwd,
    gitBranch: plan.branch,
    entrypoint: plan.entrypoint,
    ...(plan.sessionKind ? { sessionKind: plan.sessionKind } : {}),
  };
  const sessionDir = `${plan.project.dirName}/${plan.sessionId}`;
  const files: SessionOutput['files'] = [];
  const usageByModel = new Map<ModelKey, ModelTally>();
  let agents = 0;
  let workflowRuns = 0;
  let agentUsd = 0;
  let agentRequests = 0;

  if (plan.divergence === 'hidden-calls') {
    // Nothing was ever billed to the file: only Claude Code's own background title call shows up.
    const t = new Transcript(env, rng, plan.startMs, 9000);
    t.prompt(plan.prompt);
    t.synthetic('API Error: Request was aborted.');
    t.lines.pushBare({ type: 'ai-title', aiTitle: plan.title });
    t.lines.pushBare({
      type: 'cost-state',
      totalCostUSD: 0.0084,
      totalAPIDuration: 1400,
      totalDuration: 6000,
      totalToolDuration: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      startTime: plan.startMs,
      modelUsage: {
        [MODEL_IDS.haiku]: {
          inputTokens: 1580,
          outputTokens: 24,
          thinkingTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0.0084,
        },
      },
      hasUnknownModelCost: false,
    });
    files.push({ relPath: `${plan.project.dirName}/${plan.sessionId}.jsonl`, text: t.lines.text() });
    return { files, usd: 0, requests: 0, agents: 0, workflowRuns: 0, compactions: 0, endMs: t.now, lineCount: t.lines.length };
  }

  const baseContext = plan.size === 'large' ? rng.int(30_000, 48_000) : rng.int(18_000, 34_000);
  const compactAt = plan.size === 'large' ? COMPACT_AT_TOKENS + rng.int(0, 20_000) : COMPACT_AT_TOKENS;
  const t = new Transcript(env, rng, plan.startMs, baseContext);

  // Turn 0: session-start hooks and the harness context that lands before the first prompt.
  t.hookSuccess(3, `Loaded ${rng.int(2, 6)} project notes for ${plan.project.slug}\n`);
  let added = 0;
  if (rng.chance(0.35)) {
    const systemPrompt = filler(rng.int(4000, 9000), rng.int(1, 1e9), 'prose');
    t.attachment('prompt_snapshot', { systemPrompt: [systemPrompt] }, systemPrompt);
  }
  added += harnessAttachment(t, rng, plan.project);
  if (rng.chance(0.3)) added += harnessAttachment(t, rng, plan.project);

  // How much of the session's budget the delegated work gets.
  const agentBudget = plan.agents > 0 || plan.workflow ? plan.targetUsd * rng.float(0.12, 0.26) : 0;
  const mainTarget = plan.targetUsd - agentBudget;
  let agentsLeft = plan.agents;
  let workflowLeft = plan.workflow;
  let imageLeft = plan.image;
  let searchLeft = plan.webSearch;
  let fallbackLeft = plan.fallback;
  let errorLeft = plan.apiError;
  let fastLeft = plan.fast ? rng.int(2, 5) : 0;
  let cold = true;
  let turn = 0;
  let attribution: Record<string, string> | undefined;

  while (t.usd < mainTarget && t.requests < MAX_REQUESTS_PER_SESSION) {
    turn += 1;
    if (turn > 1 && rng.chance(0.3)) {
      // Idle long enough for the prompt cache to expire: the next request re-writes everything.
      t.advance(rng.int(8, 95) * 60_000);
      cold = true;
      if (rng.chance(0.25)) t.system('away_summary', { content: 'Away while the suite ran.', level: 'info' });
    }
    added += t.prompt(turn === 1 ? plan.prompt : rng.pick(FOLLOW_UPS), { image: turn === 1 && plan.image });
    if (rng.chance(0.28)) {
      const context = filler(rng.int(150, 800), rng.int(1, 1e9), 'prose');
      t.attachment('hook_additional_context', {
        hookName: 'UserPromptSubmit',
        hookEvent: 'UserPromptSubmit',
        toolUseID: rng.uuid(),
        content: [context],
      });
      added += tokensOfChars(context.length);
    }

    const steps = plan.size === 'small' ? rng.int(1, 4) : rng.int(2, 8);
    for (let step = 0; step < steps; step += 1) {
      if (t.requests >= MAX_REQUESTS_PER_SESSION) break;
      if (t.usd >= mainTarget && step > 0) break;

      const wantAgent = agentsLeft > 0 && turn > 1 && rng.chance(0.3);
      const wantWorkflow = workflowLeft && turn > 2 && rng.chance(0.35);
      const useImage = imageLeft && rng.chance(0.4);
      const useSearch = searchLeft && rng.chance(0.4);
      const isFinal = step === steps - 1 && !wantAgent && !wantWorkflow;

      const model = plan.model;
      const useFallback = fallbackLeft && turn > 1 && rng.chance(0.5);
      const { output, thinking } = outputFor(useFallback ? 'opus48' : model, rng);
      const blocks: Block[] = [];
      if (useFallback) blocks.push({ type: 'fallback', from: { model: MODEL_IDS.fable }, to: { model: MODEL_IDS.opus48 } });
      if (thinking > 0) {
        blocks.push({
          type: 'thinking',
          thinking: `${rng.pick(THINK_SNIPPETS)} ${filler(rng.int(80, 260), rng.int(1, 1e9))}`,
        });
      }
      blocks.push({ type: 'text', text: rng.pick(TEXT_SNIPPETS) });

      let tool: ToolPlan | undefined;
      let toolUseId = '';
      if (wantAgent || wantWorkflow) {
        toolUseId = `toolu_${rng.hex(12)}`;
        tool = wantWorkflow
          ? {
              name: 'Workflow',
              input: { scriptPath: `${plan.project.cwd}/.claude/workflows/review.js` },
              resultTokens: rng.int(40, 90),
              isError: false,
            }
          : {
              name: 'Agent',
              input: {
                description: rng.pick(AGENT_DESCRIPTIONS),
                prompt: `${rng.pick(FOLLOW_UPS)} ${filler(rng.int(200, 600), rng.int(1, 1e9), 'prose')}`,
                subagent_type: rng.pick(AGENT_TYPES),
              },
              resultTokens: rng.int(300, 1200),
              isError: false,
            };
        blocks.push({ type: 'tool_use', id: toolUseId, name: tool.name, input: tool.input });
      } else if (!isFinal || rng.chance(0.35)) {
        tool = pickTool(rng, plan.project, { image: useImage, webSearch: useSearch });
        toolUseId = `toolu_${rng.hex(12)}`;
        blocks.push({ type: 'tool_use', id: toolUseId, name: tool.name, input: tool.input });
      }

      const fast = fastLeft > 0 && (model === 'opus' || model === 'opus48') && rng.chance(0.5);
      if (fast) fastLeft -= 1;
      t.request({
        model,
        cold,
        added,
        output,
        thinking,
        blocks,
        stopReason: tool ? 'tool_use' : 'end_turn',
        ...(fast ? { fast: true } : {}),
        ...(useSearch ? { webSearch: 1 } : {}),
        ...(cold && rng.chance(0.12) ? { oneHourWrite: true } : {}),
        ...(useFallback ? { fallback: true } : {}),
        effort: plan.size === 'large' ? 'high' : 'medium',
        ...(attribution ? { attribution } : {}),
      });
      cold = false;
      added = 0;
      attribution = undefined;
      if (useFallback) fallbackLeft = false;

      if (!tool) break;

      if (tool.name === 'Agent') {
        const agentId = rng.hex(17);
        const nestSpec =
          agentsLeft === plan.agents && plan.agents >= 3
            ? {
                agentId: rng.hex(17),
                agentType: rng.pick(AGENT_TYPES),
                description: rng.pick(AGENT_DESCRIPTIONS),
                model: 'haiku' as ModelKey,
                targetUsd: (agentBudget / Math.max(1, plan.agents)) * 0.3,
                toolUseId: '',
                parentAgentId: agentId,
                spawnDepth: 2,
              }
            : undefined;
        const agent = buildAgent(
          {
            agentId,
            agentType: String((tool.input as Record<string, unknown>)['subagent_type'] ?? 'general-purpose'),
            description: String((tool.input as Record<string, unknown>)['description'] ?? 'Delegated work'),
            model: rng.chance(0.78) ? 'sonnet' : 'haiku',
            targetUsd: agentBudget / Math.max(1, plan.agents),
            toolUseId,
            spawnDepth: 1,
            dir: `${sessionDir}/subagents`,
            startMs: t.now,
            ...(nestSpec ? { nested: nestSpec } : {}),
          },
          plan,
          rng,
        );
        files.push(...agent.files);
        agents += agent.agents;
        agentUsd += agent.usd;
        agentRequests += agent.requests;
        mergeUsage(usageByModel, agent.usageByModel);
        agentsLeft -= 1;
        if (rng.chance(0.35)) {
          // Async launch: the parent gets a receipt, not the answer.
          t.toolResult(toolUseId, { text: 'Async agent launched successfully.' }, {
            isAsync: true,
            status: 'async_launched',
            agentId,
            description: (tool.input as Record<string, unknown>)['description'],
            resolvedModel: MODEL_IDS[rng.chance(0.6) ? 'sonnet' : 'haiku'],
            prompt: (tool.input as Record<string, unknown>)['prompt'],
            outputFile: `/tmp/agents/${agentId}.output`,
            canReadOutputFile: true,
          });
          added = rng.int(20, 60);
        } else {
          t.toolResult(toolUseId, { blocks: [{ type: 'text', text: agent.resultText }] }, {
            status: 'completed',
            prompt: (tool.input as Record<string, unknown>)['prompt'],
            agentId,
            agentType: (tool.input as Record<string, unknown>)['subagent_type'],
            content: [{ type: 'text', text: agent.resultText }],
            totalDurationMs: agent.durationMs,
            totalTokens: agent.lastUsage.output + agent.lastUsage.cache5m,
            totalToolUseCount: agent.requests,
            usage: usageJson(agent.lastUsage),
            toolStats: {
              readCount: rng.int(0, 12),
              searchCount: rng.int(0, 6),
              bashCount: rng.int(0, 8),
              editFileCount: rng.int(0, 4),
              linesAdded: rng.int(0, 60),
              linesRemoved: rng.int(0, 30),
              otherToolCount: rng.int(0, 3),
            },
          });
          added = tokensOfChars(agent.resultText.length);
        }
        continue;
      }

      if (tool.name === 'Workflow') {
        const runId = `wf_${rng.hex(10)}`;
        const runDir = `${sessionDir}/subagents/workflows/${runId}`;
        const lensCount = rng.int(2, 4);
        const journal: string[] = [];
        for (let i = 0; i < lensCount; i += 1) {
          const agentId = rng.hex(17);
          const lens = WORKFLOW_LENSES[i % WORKFLOW_LENSES.length] ?? 'Review lens';
          const agent = buildAgent(
            {
              agentId,
              agentType: 'general-purpose',
              description: lens,
              model: i === 0 ? 'sonnet' : rng.chance(0.7) ? 'sonnet' : 'haiku',
              targetUsd: (agentBudget * 0.6) / lensCount,
              toolUseId,
              spawnDepth: 1,
              dir: runDir,
              startMs: t.now + i * 4000,
            },
            plan,
            rng,
          );
          files.push(...agent.files);
          agents += agent.agents;
          agentUsd += agent.usd;
          agentRequests += agent.requests;
          mergeUsage(usageByModel, agent.usageByModel);
          journal.push(JSON.stringify({ type: 'started', key: `v2:${rng.hex(6)}`, agentId }));
          journal.push(
            JSON.stringify(
              i === lensCount - 1 && rng.chance(0.4)
                ? { type: 'failed', key: `v2:${rng.hex(6)}`, agentId }
                : { type: 'result', key: `v2:${rng.hex(6)}`, agentId, result: agent.resultText.slice(0, 160) },
            ),
          );
        }
        files.push({ relPath: `${runDir}/journal.jsonl`, text: `${journal.join('\n')}\n` });
        files.push({
          relPath: `${sessionDir}/workflows/scripts/review.js`,
          text: '// synthetic demo workflow script; never executed\nexport default async function run() {}\n',
        });
        workflowRuns += 1;
        workflowLeft = false;
        t.toolResult(toolUseId, { text: `Workflow launched in background. Run ID: ${runId}` }, {
          status: 'launched',
          taskId: `tsk_${rng.hex(8)}`,
          taskType: 'workflow',
          workflowName: `${plan.project.slug}-review`,
          runId,
          summary: `${lensCount}-lens review of the change`,
          transcriptDir: `/Users/dev/.claude/projects/${runDir}`,
          scriptPath: `${plan.project.cwd}/.claude/workflows/review.js`,
        });
        added = rng.int(30, 80);
        continue;
      }

      // Plain tool call: the result is sized so its characters match the tokens it adds.
      if (tool.image) {
        t.toolResult(toolUseId, {
          blocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }],
        });
        imageLeft = false;
        added = tool.resultTokens;
      } else {
        const resultText = filler(Math.round(tool.resultTokens * CHARS_PER_TOKEN), rng.int(1, 1e9));
        t.toolResult(toolUseId, { text: resultText, ...(tool.isError ? { isError: true } : {}) });
        added = tool.resultTokens;
      }
      if (useSearch) searchLeft = false;
      if (tool.name === 'Skill') attribution = { attributionSkill: String((tool.input as Record<string, unknown>)['skill'] ?? '') };
      if (tool.name.startsWith('mcp__')) {
        const parts = tool.name.split('__');
        attribution = { attributionMcpServer: parts[1] ?? '', attributionMcpTool: parts[2] ?? '' };
      }
      if (tool.name === 'Write' && rng.chance(0.35)) attribution = { attributionPlugin: rng.pick(PLUGINS) };

      if ((tool.name === 'Edit' || tool.name === 'Write') && rng.chance(0.62)) {
        t.hookSuccess(0, 'format-on-edit: 1 file rewritten\n', rng.chance(0.04) ? 1 : 0);
      }
      if (tool.name === 'Bash' && rng.chance(0.5)) {
        // A JSON control payload on stdout is a decision, not context: it costs nothing.
        t.hookSuccess(1, '{"decision":"allow"}\n');
      }
      if (rng.chance(0.22)) added += harnessAttachment(t, rng, plan.project);
      if (rng.chance(0.05)) {
        t.attachment('hook_blocking_error', {
          hookName: 'PreToolUse:Bash',
          hookEvent: 'PreToolUse',
          toolUseID: toolUseId,
          blockingError: {
            blockingError: 'policy-check: this command writes outside the repo.',
            command: './scripts/policy-check.sh',
          },
        });
        added += 12;
      }
      if (rng.chance(0.004)) {
        t.attachment('hook_cancelled', {
          hookName: 'PostToolUse:Edit',
          hookEvent: 'PostToolUse',
          command: './scripts/format-on-edit.sh',
          durationMs: 60_000,
          timedOut: true,
          timeoutMs: 60_000,
        });
      }
      if (errorLeft && rng.chance(0.25)) {
        t.system('api_error', {
          level: 'error',
          error: { message: '529 overloaded_error', status: 529, formatted: '529 overloaded_error' },
          retryAttempt: 1,
          maxRetries: 10,
        });
        t.synthetic('API Error: 529 overloaded_error');
        errorLeft = false;
      }
    }

    t.stopHooks();
    t.system('turn_duration', { durationMs: rng.int(9000, 420_000), messageCount: rng.int(4, 40) });
    if (rng.chance(0.12)) {
      t.lines.push(t.advance(400), {
        type: 'system',
        subtype: 'local_command',
        content: `<command-name>/${rng.pick(['status', 'cost', 'review', 'compact'])}</command-name>\n<command-message>run it</command-message>`,
        level: 'info',
      });
    }
    if (t.ctx > compactAt) {
      t.compact(t.ctx);
      cold = true;
      added = 0;
    }
  }

  mergeUsage(usageByModel, t.usageByModel);
  const totalUsd = t.usd + agentUsd;

  // Trailing fact lines, in the order Claude Code writes them.
  t.lines.pushBare({ type: 'ai-title', aiTitle: plan.title });
  if (plan.customTitleLine) t.lines.pushBare({ type: 'custom-title', customTitle: `${plan.title} (pinned)` });
  if (plan.prLink) {
    t.lines.pushBare({
      type: 'pr-link',
      prNumber: rng.int(120, 980),
      prUrl: `https://github.com/lumen/${plan.project.slug}/pull/${rng.int(120, 980)}`,
      prRepository: `lumen/${plan.project.slug}`,
      timestamp: new Date(t.advance(1000)).toISOString(),
    });
  }
  t.lines.pushBare(costStateLine(plan, totalUsd, usageByModel, t));
  t.lines.pushBare({ type: 'mode', mode: rng.chance(0.85) ? 'normal' : 'plan' });
  t.lines.pushBare({ type: 'permission-mode', permissionMode: rng.chance(0.6) ? 'auto' : 'default' });
  if (rng.chance(0.25)) {
    t.lines.pushBare({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: new Date(t.now).toISOString(),
      content: 'And then open the PR.',
    });
  }
  if (plan.continuedIn && plan.continuedInSessionId) {
    t.lines.pushBare({
      type: 'continued-in',
      timestamp: new Date(t.advance(1000)).toISOString(),
      continuedInSessionId: plan.continuedInSessionId,
    });
  }
  t.lines.pushBare({ type: 'last-prompt', prompt: 'And then open the PR.' });

  files.push({ relPath: `${plan.project.dirName}/${plan.sessionId}.jsonl`, text: t.lines.text() });
  if (plan.customTitleFile) {
    files.push({
      relPath: `${sessionDir}/custom-title.json`,
      text: `${JSON.stringify({ customTitle: `${plan.title} — kept` })}\n`,
    });
  }
  if (rng.chance(0.2)) {
    files.push({
      relPath: `${sessionDir}/tool-results/persisted-${rng.hex(6)}.txt`,
      text: `${filler(rng.int(400, 2000), rng.int(1, 1e9))}\n`,
    });
  }

  return {
    files,
    usd: totalUsd,
    requests: t.requests + agentRequests,
    agents,
    workflowRuns,
    compactions: t.compactions,
    endMs: t.now,
    lineCount: t.lines.length,
  };
}

/**
 * Claude Code's own tally. It is a per-process counter, not a per-session one, so most sessions
 * are written to agree exactly with the file (`match`) and a few are deliberately offset to
 * reproduce the other statuses `core/cost/reported.ts` classifies.
 */
function costStateLine(
  plan: SessionPlan,
  totalUsd: number,
  usageByModel: Map<ModelKey, ModelTally>,
  t: Transcript,
): Record<string, unknown> {
  const factor = plan.divergence === 'tally-more' ? 1.85 : plan.divergence === 'file-more' ? 0.45 : 1;
  const modelUsage: Record<string, unknown> = {};
  for (const [model, tally] of usageByModel) {
    const usage = tally.usage;
    modelUsage[REPORTED_MODEL_IDS[model]] = {
      inputTokens: Math.round(usage.input * factor),
      outputTokens: Math.round(usage.output * factor),
      thinkingTokens: Math.round(usage.thinking * factor),
      cacheReadInputTokens: Math.round(usage.cacheRead * factor),
      cacheCreationInputTokens: Math.round((usage.cache5m + usage.cache1h) * factor),
      webSearchRequests: usage.webSearch,
      costUSD: tally.usd * factor,
    };
  }
  return {
    type: 'cost-state',
    totalCostUSD: totalUsd * factor,
    totalAPIDuration: Math.round((t.now - plan.startMs) * 0.32),
    totalDuration: t.now - plan.startMs,
    totalToolDuration: Math.round((t.now - plan.startMs) * 0.11),
    totalLinesAdded: Math.round(totalUsd * 9),
    totalLinesRemoved: Math.round(totalUsd * 4),
    startTime: plan.startMs,
    modelUsage,
    hasUnknownModelCost: false,
  };
}

// ─────────────────────────────── tree ───────────────────────────────

/**
 * Builds the whole dataset in memory. Pure: no clock, no filesystem, no `Math.random`. Paths in
 * the returned map are relative to the generated `projects/` root, and every absolute path that
 * appears *inside* a file is fictional (`/Users/dev/…`), never a path on this machine.
 */
export function buildDemoTree(options: DemoOptions = {}): DemoTree {
  const seed = options.seed ?? DEMO_SEED;
  const now = options.now ?? Date.now();
  const sessionCount = options.sessions ?? DEMO_SESSION_COUNT;
  const rng = new Rng(seed);
  const plans = buildPlans(rng, now, sessionCount);

  const files = new Map<string, string>();
  const indexEntries = new Map<string, Record<string, unknown>[]>();
  let requests = 0;
  let agents = 0;
  let workflowRuns = 0;
  let totalUsd = 0;

  for (const plan of plans) {
    const session = buildSession(plan, rng);
    for (const file of session.files) files.set(file.relPath, file.text);
    requests += session.requests;
    agents += session.agents;
    workflowRuns += session.workflowRuns;
    totalUsd += session.usd;

    const entries = indexEntries.get(plan.project.dirName) ?? [];
    entries.push({
      sessionId: plan.sessionId,
      // Relative to the generated root on purpose: an absolute path here would bake this
      // machine's home directory into a dataset meant to be copied around.
      fullPath: `${plan.project.dirName}/${plan.sessionId}.jsonl`,
      fileMtime: session.endMs,
      firstPrompt: plan.prompt,
      summary: plan.title,
      messageCount: session.lineCount,
      created: new Date(plan.startMs).toISOString(),
      modified: new Date(session.endMs).toISOString(),
      gitBranch: plan.branch,
      projectPath: plan.project.cwd,
      isSidechain: false,
    });
    indexEntries.set(plan.project.dirName, entries);
  }

  for (const [dirName, entries] of indexEntries) {
    files.set(`${dirName}/sessions-index.json`, `${JSON.stringify({ version: 1, entries })}\n`);
  }
  // A project-level `memory/` directory: discovery must skip it.
  const firstProject = DEMO_PROJECTS[0];
  if (firstProject) {
    files.set(
      `${firstProject.dirName}/memory/notes.md`,
      '# Demo notes\n\nSynthetic file; discovery skips project-level `memory/`.\n',
    );
  }

  let bytes = 0;
  for (const text of files.values()) bytes += Buffer.byteLength(text, 'utf8');
  const starts = plans.map((p) => p.startMs);

  return {
    files,
    summary: {
      projects: new Set(plans.map((p) => p.project.dirName)).size,
      sessions: plans.length,
      files: files.size,
      requests,
      agents,
      workflowRuns,
      bytes,
      totalUsd,
      firstDate: dateKey(Math.min(...starts)),
      lastDate: dateKey(Math.max(...starts)),
    },
  };
}

/** Writes a built tree under `projectsDir` (which is created if missing). */
export async function writeDemoTree(tree: DemoTree, projectsDir: string): Promise<void> {
  const dirs = new Set<string>();
  for (const relPath of tree.files.keys()) dirs.add(path.dirname(path.join(projectsDir, relPath)));
  for (const dir of [...dirs].sort()) await mkdir(dir, { recursive: true });
  for (const [relPath, text] of tree.files) {
    await writeFile(path.join(projectsDir, relPath), text, 'utf8');
  }
}

export interface GenerateDemoDataOptions extends DemoOptions {
  /** demo home; the transcripts land in `<outDir>/projects` */
  outDir: string;
}

/** Marker the generator leaves at the root of the tree it wrote, so a rerun knows it may replace it. */
export const DEMO_MARKER = '.cca-demo-dataset';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds and writes the dataset. Returns the summary the CLI prints.
 *
 * A rerun with a different `now` draws a different number of requests per session, so file names
 * downstream of that point differ and a previous tree would leave stale sessions behind. The
 * generator therefore replaces a tree it wrote itself (recognised by `DEMO_MARKER`) and refuses to
 * touch a `projects` directory it did not write.
 */
export async function generateDemoData(options: GenerateDemoDataOptions): Promise<DemoSummary> {
  const tree = buildDemoTree(options);
  const projectsDir = path.join(options.outDir, 'projects');
  const marker = path.join(projectsDir, DEMO_MARKER);
  if (await exists(projectsDir)) {
    if (!(await exists(marker))) {
      throw new Error(`${projectsDir} exists and was not written by the demo generator; refusing to replace it`);
    }
    await rm(projectsDir, { recursive: true, force: true });
  }
  await writeDemoTree(tree, projectsDir);
  await writeFile(
    marker,
    `${JSON.stringify({ seed: options.seed ?? null, sessions: tree.summary.sessions, files: tree.summary.files })}\n`,
    'utf8',
  );
  return tree.summary;
}

/**
 * Store-level checks that need more than one project / date / billing flag than the shared
 * fixture provides: the project range (SPEC §7.2 `/api/projects`), the scratch-session count,
 * the agent description fallback, and the cache-TTL / speed / geo modifiers end to end.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryContext, Store } from '../../../core/store.js';
import type {
  DiscoveredFile,
  DiscoveredSession,
  ParsedSession,
  ParsedTranscript,
  PricingConfig,
  UserSettings,
} from '../../../core/types.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { defaultSettings } from '../../../core/settings.js';
import { runIndex } from '../../../core/db/indexer.js';
import { createStore } from '../../../core/db/store.js';
import { block, message, request, transcript, usage } from '../cost/builders.js';

const settings: UserSettings = { ...defaultSettings(), hideScratchProjects: false };
const NOW = new Date(2026, 8, 7, 12, 0, 0);

function ctxWith(pricing: PricingConfig = defaultPricing()): QueryContext {
  return { pricing, settings, now: NOW };
}

/** Local wall-clock timestamp, so `dateLocal` is the same day in every timezone. */
function localTs(year: number, monthIndex: number, day: number, hour = 12): string {
  return new Date(year, monthIndex, day, hour).toISOString();
}

interface SessionSpec {
  sessionId: string;
  projectDirName: string;
  cwd: string;
  /** one request per timestamp */
  requestTs: string[];
  agents?: { agentId: string; description?: string; firstPrompt?: string; runId?: string }[];
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function fileFor(spec: SessionSpec, agentId?: string): DiscoveredFile {
  const base = `/tmp/cca-range/${spec.projectDirName}/${spec.sessionId}`;
  const out: DiscoveredFile = {
    path: agentId ? `${base}/subagents/agent-${agentId}.jsonl` : `${base}.jsonl`,
    size: 512,
    mtimeMs: 1_757_000_000_000,
    kind: agentId ? 'subagent' : 'main',
    projectDirName: spec.projectDirName,
    sessionId: spec.sessionId,
  };
  if (agentId) out.agentId = agentId;
  return out;
}

function sessionFrom(spec: SessionSpec): ParsedSession {
  const first = spec.requestTs[0] ?? localTs(2026, 8, 7);
  const last = spec.requestTs[spec.requestTs.length - 1] ?? first;
  const main = transcript({
    file: fileFor(spec),
    meta: { cwd: spec.cwd, firstTs: first, lastTs: last, lineCount: spec.requestTs.length, parseErrors: 0 },
    requests: spec.requestTs.map((ts, i) =>
      request({
        seq: i,
        ts,
        turnIndex: 1,
        usage: usage({ input: 1000, output: 100 }),
        blocks: [block({ type: 'text', chars: 10 })],
      }),
    ),
    messages: [message({ seq: 0, ts: first, kind: 'prompt', preview: 'do a thing' })],
  });
  const agents: ParsedTranscript[] = (spec.agents ?? []).map((a) =>
    transcript({
      file: fileFor(spec, a.agentId),
      agentId: a.agentId,
      meta: {
        cwd: spec.cwd,
        firstTs: first,
        lastTs: last,
        lineCount: 2,
        parseErrors: 0,
        ...(a.firstPrompt ? { firstPrompt: a.firstPrompt } : {}),
      },
      requests: [request({ seq: 1, ts: first, usage: usage({ input: 10, output: 5 }) })],
      messages: [],
    }),
  );
  const discovered: DiscoveredSession = {
    projectDirName: spec.projectDirName,
    projectDirPath: `/tmp/cca-range/${spec.projectDirName}`,
    sessionId: spec.sessionId,
    mainFile: main.file,
    agentFiles: agents.map((a) => a.file),
    workflowRuns: [],
  };
  const agentMeta: ParsedSession['agentMeta'] = {};
  for (const a of spec.agents ?? []) {
    agentMeta[a.agentId] = { agentType: 'workflow-subagent', ...(a.description ? { description: a.description } : {}) };
  }
  return { discovered, main, agents, agentMeta, workflowRuns: [] };
}

async function storeFor(specs: SessionSpec[]): Promise<Store> {
  const root = mkdtempSync(join(tmpdir(), 'cca-range-'));
  const dbPath = join(root, 'index.sqlite');
  const sessions = specs.map(sessionFrom);
  await runIndex({
    roots: [root],
    dbPath,
    pricing: defaultPricing(),
    discover: async () => sessions.map((s) => s.discovered),
    parse: async (d) => sessions.find((s) => s.discovered.sessionId === d.sessionId)!,
  });
  const store = createStore(dbPath);
  cleanup.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return store;
}

/** 1000 input + 100 output on Opus 5 list prices. */
const PER_REQUEST = (1000 * 5 + 100 * 25) / 1e6;

describe('listProjects range', () => {
  const specs: SessionSpec[] = [
    {
      sessionId: 'sess-span',
      projectDirName: '-Users-dev-alpha',
      cwd: '/Users/dev/alpha',
      // straddles the window: one request before `from`, two inside it
      requestTs: [localTs(2026, 7, 1), localTs(2026, 8, 6), localTs(2026, 8, 7)],
    },
    {
      sessionId: 'sess-old',
      projectDirName: '-Users-dev-beta',
      cwd: '/Users/dev/beta',
      requestTs: [localTs(2026, 6, 15)],
    },
  ];

  it('defaults to the last 30 days and echoes the resolved range', async () => {
    const store = await storeFor(specs);
    const res = await store.listProjects(ctxWith());
    expect(res.range).toEqual({ from: '2026-08-09', to: '2026-09-07' });
  });

  it('counts only the requests inside the range, not the whole session', async () => {
    const store = await storeFor(specs);
    const res = await store.listProjects(ctxWith(), { from: '2026-09-01', to: '2026-09-07' });
    const alpha = res.projects.find((p) => p.id === '-Users-dev-alpha');
    expect(alpha?.totalCost).toBeCloseTo(PER_REQUEST * 2, 12);
    expect(alpha?.sessionCount).toBe(1);
    expect(res.totalCost).toBeCloseTo(PER_REQUEST * 2, 12);
  });

  it('still lists a project with nothing in the range, at zero', async () => {
    const store = await storeFor(specs);
    const res = await store.listProjects(ctxWith(), { from: '2026-09-01', to: '2026-09-07' });
    const beta = res.projects.find((p) => p.id === '-Users-dev-beta');
    expect(beta).toBeDefined();
    expect(beta?.sessionCount).toBe(0);
    expect(beta?.totalCost).toBe(0);
    // all-time activity bounds survive, so the rail can still date the project
    expect(beta?.firstActivity).not.toBeNull();
  });

  it('matches the overview: Σ byProject equals the range total', async () => {
    const store = await storeFor(specs);
    const q = { from: '2026-08-01', to: '2026-09-07' };
    const overview = await store.overview(q, ctxWith());
    const byProject = overview.byProject.reduce((sum, row) => sum + row.cost, 0);
    const daily = overview.daily.reduce((sum, d) => sum + d.cost, 0);
    const byModel = overview.byModel.reduce((sum, m) => sum + m.cost.total, 0);
    expect(byProject).toBeCloseTo(overview.totals.cost.total, 12);
    expect(daily).toBeCloseTo(overview.totals.cost.total, 12);
    expect(byModel).toBeCloseTo(overview.totals.cost.total, 12);
    expect(overview.byProject.reduce((sum, r) => sum + r.sessions, 0)).toBe(overview.totals.sessions);
  });

  it('prices the overview top sessions over the range, never over their whole life', async () => {
    const store = await storeFor(specs);
    const q = { from: '2026-09-01', to: '2026-09-07' };
    const overview = await store.overview(q, ctxWith());
    const span = overview.topSessions.find((s) => s.id === 'sess-span');
    // two of `sess-span`'s three requests are inside the window
    expect(span?.cost.total).toBeCloseTo(PER_REQUEST * 2, 12);
    expect(span?.requestCount).toBe(2);
    // the whole-session number is still what the detail page and the sessions list report
    const detail = await store.getSession('sess-span', ctxWith());
    expect(detail?.summary.cost.total).toBeCloseTo(PER_REQUEST * 3, 12);
    expect(detail?.summary.requestCount).toBe(3);
    const sum = overview.topSessions.reduce((acc, s) => acc + s.cost.total, 0);
    expect(sum).toBeLessThanOrEqual(overview.totals.cost.total + 1e-12);
  });

  it('includes a request at 23:59 local on the last day and excludes 00:00 the next', async () => {
    const store = await storeFor([
      {
        sessionId: 'sess-edge',
        projectDirName: '-Users-dev-edge',
        cwd: '/Users/dev/edge',
        requestTs: [
          new Date(2026, 8, 6, 23, 59, 59).toISOString(),
          new Date(2026, 8, 7, 0, 0, 0).toISOString(),
        ],
      },
    ]);
    const upToThe6th = await store.overview({ from: '2026-09-01', to: '2026-09-06' }, ctxWith());
    expect(upToThe6th.totals.requests).toBe(1);
    expect(upToThe6th.totals.cost.total).toBeCloseTo(PER_REQUEST, 12);
    const both = await store.overview({ from: '2026-09-01', to: '2026-09-07' }, ctxWith());
    expect(both.totals.requests).toBe(2);
  });
});

describe('status', () => {
  it('counts the sessions hideScratchProjects would hide, over all time', async () => {
    const store = await storeFor([
      { sessionId: 'sess-real', projectDirName: '-Users-dev-alpha', cwd: '/Users/dev/alpha', requestTs: [localTs(2026, 8, 7)] },
      { sessionId: 'sess-tmp-1', projectDirName: '-private-var-folders-zz-T', cwd: '/private/var/folders/zz/T', requestTs: [localTs(2026, 8, 7)] },
      // outside the default 30-day window, and still counted
      { sessionId: 'sess-tmp-2', projectDirName: '-tmp-scratch', cwd: '/tmp/scratch', requestTs: [localTs(2026, 1, 2)] },
    ]);
    const status = await store.status(ctxWith());
    expect(status.counts.sessions).toBe(3);
    expect(status.scratchSessions).toBe(2);
  });
});

describe('agent description', () => {
  it('falls back to the agent transcript first prompt, truncated to 80 chars', async () => {
    const longPrompt = `Review the pricing table and ${'x'.repeat(120)}`;
    const store = await storeFor([
      {
        sessionId: 'sess-agents',
        projectDirName: '-Users-dev-alpha',
        cwd: '/Users/dev/alpha',
        requestTs: [localTs(2026, 8, 7)],
        agents: [
          { agentId: 'a-with-meta', description: 'Trace the build failure', firstPrompt: 'ignored' },
          { agentId: 'a-workflow', firstPrompt: longPrompt },
          { agentId: 'a-nothing' },
        ],
      },
    ]);
    const tree = await store.getAgentTree('sess-agents', ctxWith());
    const byId = new Map((tree?.agents ?? []).map((a) => [a.agentId, a]));
    expect(byId.get('a-with-meta')?.description).toBe('Trace the build failure');
    expect(byId.get('a-workflow')?.description).toBe(longPrompt.slice(0, 80));
    expect(byId.get('a-workflow')?.description).toHaveLength(80);
    expect(byId.get('a-nothing')?.description).toBeUndefined();
  });
});

describe('billing modifiers, end to end through the store', () => {
  const TS = localTs(2026, 8, 7);

  async function storeWithRequests(reqs: Parameters<typeof request>[0][]): Promise<Store> {
    const root = mkdtempSync(join(tmpdir(), 'cca-flags-'));
    const dbPath = join(root, 'index.sqlite');
    const file: DiscoveredFile = {
      path: '/tmp/cca-flags/-Users-dev-flags/sess-flags.jsonl',
      size: 512,
      mtimeMs: 1,
      kind: 'main',
      projectDirName: '-Users-dev-flags',
      sessionId: 'sess-flags',
    };
    const main = transcript({
      file,
      meta: { cwd: '/Users/dev/flags', firstTs: TS, lastTs: TS, lineCount: reqs.length, parseErrors: 0 },
      requests: reqs.map((r) => request(r)),
      messages: [],
    });
    const discovered: DiscoveredSession = {
      projectDirName: '-Users-dev-flags',
      projectDirPath: '/tmp/cca-flags/-Users-dev-flags',
      sessionId: 'sess-flags',
      mainFile: file,
      agentFiles: [],
      workflowRuns: [],
    };
    const session: ParsedSession = { discovered, main, agents: [], agentMeta: {}, workflowRuns: [] };
    await runIndex({
      roots: [root],
      dbPath,
      pricing: defaultPricing(),
      discover: async () => [discovered],
      parse: async () => session,
    });
    const store = createStore(dbPath);
    cleanup.push(() => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    });
    return store;
  }

  it('prices ephemeral_5m at 1.25x and ephemeral_1h at 2x the input price', async () => {
    const store = await storeWithRequests([
      { seq: 0, ts: TS, usage: usage({ cache5m: 1_000_000 }) },
      { seq: 1, ts: TS, usage: usage({ cache1h: 1_000_000 }) },
    ]);
    const detail = await store.getSession('sess-flags', ctxWith());
    const costs = (detail?.requests ?? []).map((r) => r.cost.total);
    // Opus 5 input is $5/MTok, so the two writes are $6.25 and $10.
    expect(costs[0]).toBeCloseTo(6.25, 10);
    expect(costs[1]).toBeCloseTo(10, 10);
    expect(costs[0]! / 5).toBeCloseTo(1.25, 10);
    expect(costs[1]! / 5).toBeCloseTo(2, 10);
  });

  it('re-buckets an assumed-TTL cache write per the pricing setting, with no reindex', async () => {
    const assumed = usage({ cache5m: 1_000_000 });
    assumed.assumedTtl = true;
    const store = await storeWithRequests([{ seq: 0, ts: TS, usage: assumed }]);

    const asFiveMinutes = defaultPricing();
    expect(asFiveMinutes.assumeCacheWriteTtlWhenUnknown).toBe('5m');
    const at5m = await store.getSession('sess-flags', ctxWith(asFiveMinutes));
    expect(at5m?.summary.cost.total).toBeCloseTo(6.25, 10);
    expect(at5m?.summary.tokens.cache5m).toBe(1_000_000);
    expect(at5m?.summary.tokens.cache1h).toBe(0);

    // the same index, only the setting changed
    const asOneHour: PricingConfig = { ...defaultPricing(), assumeCacheWriteTtlWhenUnknown: '1h' };
    const at1h = await store.getSession('sess-flags', ctxWith(asOneHour));
    expect(at1h?.summary.cost.total).toBeCloseTo(10, 10);
    expect(at1h?.summary.tokens.cache5m).toBe(0);
    expect(at1h?.summary.tokens.cache1h).toBe(1_000_000);
    // the context total is the same either way, so nothing else moves
    expect(at1h?.summary.tokens.context).toBe(at5m?.summary.tokens.context);

    const overview1h = await store.overview({ from: '2026-09-01', to: '2026-09-07' }, ctxWith(asOneHour));
    expect(overview1h.totals.cost.total).toBeCloseTo(10, 10);
  });

  it('leaves a reported TTL split alone whatever the setting says', async () => {
    const store = await storeWithRequests([{ seq: 0, ts: TS, usage: usage({ cache5m: 1_000_000 }) }]);
    const asOneHour: PricingConfig = { ...defaultPricing(), assumeCacheWriteTtlWhenUnknown: '1h' };
    const detail = await store.getSession('sess-flags', ctxWith(asOneHour));
    expect(detail?.summary.cost.total).toBeCloseTo(6.25, 10);
    expect(detail?.summary.tokens.cache5m).toBe(1_000_000);
  });

  it('bills speed "fast" at the fast rate card', async () => {
    const store = await storeWithRequests([
      { seq: 0, ts: TS, usage: usage({ input: 1_000_000, output: 1_000_000 }), speed: 'fast' },
    ]);
    const detail = await store.getSession('sess-flags', ctxWith());
    // Opus 5 fast is $10 in / $50 out against $5 / $25 standard.
    expect(detail?.summary.cost.total).toBeCloseTo(60, 10);
    expect(detail?.requests[0]?.speed).toBe('fast');
  });

  it('applies the US-geo multiplier on a model that supports it', async () => {
    const store = await storeWithRequests([
      { seq: 0, ts: TS, usage: usage({ input: 1_000_000, output: 1_000_000 }), inferenceGeo: 'us' },
    ]);
    const detail = await store.getSession('sess-flags', ctxWith());
    expect(detail?.summary.cost.total).toBeCloseTo(30 * 1.1, 10);
  });

  it('halves the token terms on the batch tier', async () => {
    const store = await storeWithRequests([
      { seq: 0, ts: TS, usage: usage({ input: 1_000_000, output: 1_000_000 }), serviceTier: 'batch' },
    ]);
    const detail = await store.getSession('sess-flags', ctxWith());
    expect(detail?.summary.cost.total).toBeCloseTo(15, 10);
  });
});

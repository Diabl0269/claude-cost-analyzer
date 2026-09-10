import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Store, QueryContext } from '../../../core/store.js';
import type { DiscoveredSession, ParsedSession, UserSettings } from '../../../core/types.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { defaultSettings } from '../../../core/settings.js';
import { runIndex } from '../../../core/db/indexer.js';
import { createStore } from '../../../core/db/store.js';
import { csvField, sessionsToCsv } from '../../../core/db/csv.js';
import { decorateSnippet, ftsPhrase } from '../../../core/db/search.js';
import { decodeCursor, encodeCursor, resolveRange } from '../../../core/db/filters.js';
import { displayNameOf, isScratchPath, worktreeParent } from '../../../core/db/projects.js';
import { CWD, SESSION_ID } from '../cost/builders.js';
import { AGENT_ID, EXPECTED, EXPECTED_MAIN, EXPECTED_TOTAL, buildFixture } from './fixture.js';

const pricing = defaultPricing();
const settings: UserSettings = { ...defaultSettings(), hideScratchProjects: false };
const ctx: QueryContext = { pricing, settings, now: new Date(2026, 8, 7, 12) };

let root: string;
let store: Store;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cca-store-'));
  const dbPath = join(root, 'db', 'index.sqlite');
  const fixture = buildFixture(root);
  const discover = async (): Promise<DiscoveredSession[]> => [fixture.discovered];
  const parse = async (): Promise<ParsedSession> => fixture.session;
  await runIndex({ roots: [root], dbPath, pricing, discover, parse });
  store = createStore(dbPath);
});

afterAll(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('listProjects', () => {
  it('reports the project with its cwd path and total cost', async () => {
    const { projects, totalCost } = await store.listProjects(ctx);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.path).toBe(CWD);
    expect(projects[0]?.displayName).toBe('widget');
    expect(projects[0]?.sessionCount).toBe(1);
    expect(projects[0]?.isScratch).toBe(false);
    expect(totalCost).toBeCloseTo(EXPECTED_TOTAL, 12);
  });
});

describe('getSession', () => {
  it('returns the summary, model split and turns', async () => {
    const detail = await store.getSession(SESSION_ID, ctx);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.summary.title).toBe('Rename helper in utils');
    expect(detail.summary.titleSource).toBe('ai-title');
    expect(detail.summary.cost.total).toBeCloseTo(EXPECTED_TOTAL, 12);
    expect(detail.byModel.map((m) => m.model)).toEqual(['claude-opus-5', 'claude-haiku-4-5-20251001']);
    expect(detail.byModel[1]?.cost.total).toBeCloseTo(EXPECTED.agent, 12);
    expect(detail.requests.map((r) => r.seq)).toEqual([1, 4, 6]);
    expect(detail.turns[0]?.promptPreview).toBe('Rename the helper in utils.ts');
    expect(detail.turns[0]?.cost).toBeCloseTo(EXPECTED_MAIN, 12);
    expect(detail.turns[0]?.durationMs).toBe(42_000);
    expect(detail.facts.localCommands).toEqual(['/review']);
    expect(detail.facts.reported?.totalCostUSD).toBe(0.05);
  });

  it('splits categories into exact and estimated buckets', async () => {
    const detail = await store.getSession(SESSION_ID, ctx);
    expect(detail).not.toBeNull();
    if (!detail) return;
    const { exact, estimated } = detail.categories;
    expect(exact.total).toBeCloseTo(EXPECTED_TOTAL, 12);
    expect(exact.output).toBeCloseTo(((500 + 300 + 200) * 25 + 18 * 5) / 1e6, 12);
    expect(estimated.assistantOutput).toBeCloseTo(exact.output, 12);
    expect(estimated.userPrompts).toBeGreaterThan(0);
    expect(estimated.harness).toBeGreaterThan(0);
    expect(estimated.toolResultsByTool.map((t) => t.name).sort()).toEqual(['Agent', 'Read']);
  });

  it('attributes the re-sent history and the baseline floor, and reconciles to the context cost', async () => {
    const detail = await store.getSession(SESSION_ID, ctx);
    expect(detail).not.toBeNull();
    if (!detail) return;
    const { exact, estimated } = detail.categories;
    expect(estimated.assistantHistory ?? 0).toBeGreaterThan(0);
    expect(estimated.baseline ?? 0).toBeGreaterThan(0);
    const contextCost = exact.input + exact.cacheWrite + exact.cacheRead;
    const attributed =
      estimated.userPrompts +
      estimated.hooks +
      estimated.harness +
      estimated.compactSummaries +
      estimated.systemPrompt +
      estimated.other +
      (estimated.assistantHistory ?? 0) +
      (estimated.baseline ?? 0) +
      estimated.toolResultsByTool.reduce((sum, tool) => sum + tool.cost, 0);
    // Not exact: this fixture's second gap grows the context by 1,600 tokens while the recorded
    // characters only explain ~200, so the Δ band rejects the scaling and the difference stays in
    // the residual — the same estimation noise the UI shows as "not attributed".
    expect(Math.abs(attributed - contextCost) / contextCost).toBeLessThan(0.2);
  });

  it('prices the agent tool call with its child cost kept separate', async () => {
    const detail = await store.getSession(SESSION_ID, ctx);
    expect(detail).not.toBeNull();
    if (!detail) return;
    const agentCall = detail.toolCalls.find((c) => c.name === 'Agent');
    expect(agentCall?.childAgentId).toBe(AGENT_ID);
    expect(agentCall?.childCost).toBeCloseTo(EXPECTED.agent, 12);
    expect(agentCall?.ownCost).toBeLessThan(EXPECTED_MAIN);
    const read = detail.toolCalls.find((c) => c.name === 'Read');
    expect(read?.childCost).toBeNull();
    expect(read?.genCost).toBeGreaterThan(0);
    expect(read?.result.carryCost).toBeGreaterThan(0);
  });

  it('builds the agent tree', async () => {
    const tree = await store.getAgentTree(SESSION_ID, ctx);
    expect(tree?.agents).toHaveLength(1);
    expect(tree?.agents[0]?.agentId).toBe(AGENT_ID);
    expect(tree?.agents[0]?.agentType).toBe('general-purpose');
    expect(tree?.agents[0]?.cost.total).toBeCloseTo(EXPECTED.agent, 12);
    expect(tree?.workflowRuns).toEqual([]);
  });

  it('records the compaction with a zero rewarm when nothing followed it', async () => {
    const detail = await store.getSession(SESSION_ID, ctx);
    expect(detail?.compactions).toHaveLength(1);
    expect(detail?.compactions[0]?.trigger).toBe('auto');
    expect(detail?.compactions[0]?.rewarmCost).toBe(0);
  });

  it('returns null for an unknown session', async () => {
    expect(await store.getSession('nope', ctx)).toBeNull();
    expect(await store.getAgentTree('nope', ctx)).toBeNull();
  });
});

describe('getTranscript', () => {
  it('reads lines back from the JSONL by byte offset and attaches request costs', async () => {
    const page = await store.getTranscript(SESSION_ID, null, 0, 100, ctx);
    expect(page).not.toBeNull();
    if (!page) return;
    expect(page.messages).toHaveLength(8);
    expect(page.totalLines).toBe(8);
    expect(page.nextFromSeq).toBeNull();

    const prompt = page.messages[0];
    expect(prompt?.blocks[0]).toEqual({ type: 'text', text: 'Rename the helper in utils.ts' });

    const assistant = page.messages[1];
    expect(assistant?.blocks.map((b) => b.type)).toEqual(['text', 'tool_use']);
    expect(assistant?.request?.cost.total).toBeCloseTo(EXPECTED.request1, 12);

    const result = page.messages[2];
    expect(result?.blocks[0]).toMatchObject({ type: 'tool_result', toolUseId: 'toolu_a' });

    const attachment = page.messages[3];
    expect(attachment?.blocks[0]).toEqual({ type: 'text', text: 'Token budget reminder.' });
  });

  it('pages by seq', async () => {
    const first = await store.getTranscript(SESSION_ID, null, 0, 3, ctx);
    expect(first?.messages.map((m) => m.seq)).toEqual([0, 1, 2]);
    expect(first?.nextFromSeq).toBe(3);
    const second = await store.getTranscript(SESSION_ID, null, first?.nextFromSeq ?? 0, 3, ctx);
    expect(second?.messages.map((m) => m.seq)).toEqual([3, 4, 5]);
  });

  it('applies a what-if pricing swap to the request costs it attaches', async () => {
    const plain = await store.getTranscript(SESSION_ID, null, 0, 100, ctx);
    const swapped = await store.getTranscript(SESSION_ID, null, 0, 100, { ...ctx, whatIf: 'opus-5>sonnet-5' });
    const plainCost = plain?.messages.find((m) => m.seq === 1)?.request?.cost.total ?? 0;
    const swappedCost = swapped?.messages.find((m) => m.seq === 1)?.request?.cost.total ?? 0;
    expect(plainCost).toBeCloseTo(EXPECTED.request1, 12);
    // Opus 5 at Sonnet 5 prices: 1000 input at $2 + 500 output at $10 per MTok.
    expect(swappedCost).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6, 12);
    expect(swappedCost).not.toBeCloseTo(plainCost, 12);
  });

  it('reads a subagent transcript', async () => {
    const page = await store.getTranscript(SESSION_ID, AGENT_ID, 0, 10, ctx);
    expect(page?.agentId).toBe(AGENT_ID);
    expect(page?.messages).toHaveLength(2);
    expect(page?.messages[1]?.request?.cost.total).toBeCloseTo(EXPECTED.agent, 12);
  });
});

describe('search', () => {
  it('finds a session by a substring of its title', async () => {
    const response = await store.search({ q: 'name helper', scope: 'titles' }, ctx);
    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]?.session.id).toBe(SESSION_ID);
    expect(response.groups[0]?.titleMatch).toBe(true);
    expect(response.tookMs).toBeGreaterThanOrEqual(0);
  });

  it('finds content and highlights the match', async () => {
    const response = await store.search({ q: 'helper', scope: 'everything' }, ctx);
    expect(response.groups).toHaveLength(1);
    const group = response.groups[0];
    expect(group?.hits.length).toBeGreaterThan(0);
    expect(group?.hits.length).toBeLessThanOrEqual(3);
    expect(group?.hits[0]?.snippet).toContain('<mark>');
    expect(group?.hits[0]?.score).toBeGreaterThan(0);
  });

  it('reports the total hit count for a session, not the capped display list', async () => {
    const response = await store.search({ q: 'helper', scope: 'everything' }, ctx);
    const group = response.groups[0];
    expect(group?.hits).toHaveLength(3);
    expect(group?.hitCount).toBeGreaterThan(3);
  });

  it('filters content search by kind', async () => {
    const prompts = await store.search({ q: 'helper', kinds: ['prompt'] }, ctx);
    expect(prompts.groups[0]?.hits.every((h) => h.kind === 'prompt')).toBe(true);
    const none = await store.search({ q: 'helper', kinds: ['tool_result'], tool: 'Bash' }, ctx);
    expect(none.groups).toHaveLength(0);
  });

  it('returns nothing for an empty query', async () => {
    const response = await store.search({ q: '   ' }, ctx);
    expect(response.groups).toEqual([]);
    expect(response.totalSessions).toBe(0);
  });
});

describe('analytics', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' };

  it('overview totals match the session totals', async () => {
    const overview = await store.overview(range, ctx);
    expect(overview.totals.cost.total).toBeCloseTo(EXPECTED_TOTAL, 12);
    expect(overview.totals.requests).toBe(4);
    expect(overview.totals.sessions).toBe(1);
    expect(overview.totals.prompts).toBe(1);
    expect(overview.totals.toolCalls).toBe(2);
    expect(overview.totals.agents).toBe(1);
    expect(overview.totals.costPerPrompt).toBeCloseTo(EXPECTED_TOTAL, 12);
    expect(overview.daily.map((d) => d.date)).toEqual(['2026-09-07']);
    expect(overview.daily[0]?.cost).toBeCloseTo(EXPECTED_TOTAL, 12);
    expect(overview.byProject[0]?.requests).toBe(4);
    expect(overview.topSessions[0]?.id).toBe(SESSION_ID);
    expect(overview.unpricedModels).toEqual([]);
  });

  it('applies a what-if pricing swap without re-indexing', async () => {
    const swapped = await store.overview({ ...range, whatIf: 'opus-5>sonnet-5' }, ctx);
    const opusAtSonnet =
      ((1000 + 100 + 50) * 2 + (500 + 300 + 200) * 10 + 2000 * 2.5 + (1000 + 4000) * 0.2) / 1e6;
    expect(swapped.totals.cost.total).toBeCloseTo(opusAtSonnet + EXPECTED.agent, 12);
  });

  it('reports tool costs with child spend attributed to the Agent call', async () => {
    const tools = await store.toolsAnalytics(range, ctx);
    const agent = tools.tools.find((t) => t.name === 'Agent');
    expect(agent?.calls).toBe(1);
    expect(agent?.childCost).toBeCloseTo(EXPECTED.agent, 12);
    const read = tools.tools.find((t) => t.name === 'Read');
    expect(read?.carryCost).toBeGreaterThan(0);
    expect(read?.sessions).toBe(1);
  });

  it('splits models and speeds', async () => {
    const models = await store.modelsAnalytics(range, ctx);
    expect(models.models).toHaveLength(2);
    expect(models.bySpeed).toEqual([{ speed: 'standard', requests: 4, cost: expect.any(Number) }]);
    expect(models.daily[0]?.byModel['claude-opus-5']).toBeCloseTo(EXPECTED_MAIN, 12);
  });

  it('reports harness attachments under hooks analytics', async () => {
    const hooks = await store.hooksAnalytics(range, ctx);
    expect(hooks.hooks).toEqual([]);
    expect(hooks.harness[0]?.attachmentType).toBe('total_tokens_reminder');
    expect(hooks.totals.harnessEstCost).toBeGreaterThan(0);
    expect(hooks.totals.hookEstCost).toBe(0);
  });

  it('attributes requests to their skill and lists local commands', async () => {
    const attribution = await store.attributionAnalytics(range, ctx);
    expect(attribution.skills[0]?.name).toBe('code-review');
    expect(attribution.skills[0]?.requests).toBe(1);
    expect(attribution.localCommands).toEqual([{ name: '/review', uses: 1 }]);
  });

  it('produces insights with money impact', async () => {
    const { insights } = await store.insights(range, ctx);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((i) => Number.isFinite(i.impactUsd))).toBe(true);
    expect(insights.every((i) => i.sessions.length <= 5)).toBe(true);
  });

  it('defaults to the last 30 days when no range is given', async () => {
    const overview = await store.overview({}, ctx);
    expect(overview.range.to).toBe('2026-09-07');
    expect(overview.range.from).toBe('2026-08-09');
    expect(overview.totals.requests).toBe(4);
  });
});

describe('exports', () => {
  it('exports a session as JSON with its full transcript', async () => {
    const exported = await store.exportSession(SESSION_ID, ctx);
    expect(exported?.detail.summary.id).toBe(SESSION_ID);
    expect(exported?.transcript).toHaveLength(8);
    expect(exported?.pricing.version).toBe(1);
    expect(await store.exportSession('nope', ctx)).toBeNull();
  });

  it('writes RFC 4180 CSV', async () => {
    const csv = await store.exportSessionsCsv({}, ctx);
    const lines = csv.split('\r\n');
    expect(lines[0]?.startsWith('sessionId,title,project')).toBe(true);
    expect(lines[1]).toContain(SESSION_ID);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('csv quoting', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(null)).toBe('');
  });

  it('quotes a title containing a comma in the rendered file', () => {
    const csv = sessionsToCsv([
      {
        id: 's1',
        projectId: 'p',
        projectPath: '/repo',
        title: 'Fix, then ship "it"',
        titleSource: 'ai-title',
        firstPrompt: '',
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        activeMs: 0,
        models: [],
        promptCount: 0,
        requestCount: 0,
        toolCallCount: 0,
        agentCount: 0,
        workflowRunCount: 0,
        compactionCount: 0,
        apiErrorCount: 0,
        hookRunCount: 0,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cache5m: 0,
          cache1h: 0,
          thinking: 0,
          webSearchRequests: 0,
          context: 0,
        },
        cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: 0 },
        costMain: 0,
        costAgents: 0,
        costWorkflows: 0,
        reportedCostUsd: null,
        pinned: false,
        unpriced: false,
      },
    ]);
    expect(csv).toContain('"Fix, then ship ""it"""');
  });
});

describe('paging and filters', () => {
  it('returns a cursor only when more rows remain', async () => {
    const page = await store.listSessions({ limit: 1 }, ctx);
    expect(page.sessions).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('round-trips a cursor', () => {
    expect(decodeCursor(encodeCursor(SESSION_ID))).toBe(SESSION_ID);
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('filters by model and pinned state', async () => {
    expect((await store.listSessions({ model: 'claude-opus-5' }, ctx)).total).toBe(1);
    expect((await store.listSessions({ model: 'claude-fable-5' }, ctx)).total).toBe(0);
    expect((await store.listSessions({ pinned: true }, ctx)).total).toBe(0);
    const pinnedCtx: QueryContext = { ...ctx, settings: { ...settings, pinnedSessionIds: [SESSION_ID] } };
    const pinned = await store.listSessions({ pinned: true }, pinnedCtx);
    expect(pinned.total).toBe(1);
    expect(pinned.sessions[0]?.pinned).toBe(true);
  });

  it('filters by a date range on the session start', async () => {
    expect((await store.listSessions({ from: '2026-09-07', to: '2026-09-07' }, ctx)).total).toBe(1);
    expect((await store.listSessions({ from: '2026-01-01', to: '2026-01-31' }, ctx)).total).toBe(0);
  });
});

describe('pure helpers', () => {
  it('resolves a default 30-day range and clamps a reversed one', () => {
    const now = new Date(2026, 8, 7, 12);
    expect(resolveRange({}, now)).toEqual({ from: '2026-08-09', to: '2026-09-07' });
    expect(resolveRange({ from: '2026-09-30', to: '2026-09-01' }, now)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('escapes FTS phrases and decorates snippets safely', () => {
    expect(ftsPhrase('a "b" OR c')).toBe('"a ""b"" OR c"');
    expect(decorateSnippet('a <b> c')).toBe('a <mark>&lt;b&gt;</mark> c');
  });

  it('classifies scratch and worktree paths', () => {
    expect(isScratchPath('/private/var/folders/x/y')).toBe(true);
    expect(isScratchPath('/tmp/scratch')).toBe(true);
    expect(isScratchPath('/Users/dev/widget')).toBe(false);
    expect(worktreeParent('/Users/dev/widget/.claude/worktrees/PROJ-1')).toBe('/Users/dev/widget');
    expect(worktreeParent('/Users/dev/widget')).toBeNull();
    expect(displayNameOf('/Users/dev/widget/.claude/worktrees/PROJ-1')).toBe('widget · PROJ-1');
  });
});

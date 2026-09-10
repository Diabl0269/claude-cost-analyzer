/**
 * The content search pages by *session* but scans a window of ranked *hits*. A query whose hits
 * pile up in the first few sessions used to fill that window before reaching a second page, so
 * `nextCursor` came back null with most of the matching sessions never shown.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QueryContext, Store } from '../../../core/store.js';
import type { DiscoveredFile, DiscoveredSession, ParsedSession, UserSettings } from '../../../core/types.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { defaultSettings } from '../../../core/settings.js';
import { runIndex } from '../../../core/db/indexer.js';
import { createStore } from '../../../core/db/store.js';
import { message, request, transcript, usage } from '../cost/builders.js';

const pricing = defaultPricing();
const settings: UserSettings = { ...defaultSettings(), hideScratchProjects: false };
const ctx: QueryContext = { pricing, settings, now: new Date(2026, 8, 7, 12) };

/** Enough hits per session that even the first page's window cannot hold them all. */
const MESSAGES_PER_SESSION = 120;
const SESSION_COUNT = 8;
const SESSION_IDS = Array.from({ length: SESSION_COUNT }, (_, i) => `55555555-0000-4000-8000-00000000000${i}`);

let root: string;
let store: Store;

function sessionFor(sessionId: string, index: number): ParsedSession {
  const file: DiscoveredFile = {
    path: `/tmp/cca-search/-Users-dev-widget/${sessionId}.jsonl`,
    size: 4096,
    mtimeMs: 1_757_000_000_000,
    kind: 'main',
    projectDirName: '-Users-dev-widget',
    sessionId,
  };
  const ts = new Date(2026, 8, 7, 9, index).toISOString();
  const main = transcript({
    file,
    meta: { cwd: '/Users/dev/widget', firstTs: ts, lastTs: ts, lineCount: MESSAGES_PER_SESSION, parseErrors: 0 },
    requests: [request({ seq: 0, ts, usage: usage({ input: 100, output: 10 }) })],
    messages: Array.from({ length: MESSAGES_PER_SESSION }, (_, i) =>
      message({
        seq: i,
        ts,
        kind: 'prompt',
        searchText: `refactor the widget pipeline step ${i}`,
        preview: `refactor the widget pipeline step ${i}`,
      }),
    ),
  });
  const discovered: DiscoveredSession = {
    projectDirName: '-Users-dev-widget',
    projectDirPath: '/tmp/cca-search/-Users-dev-widget',
    sessionId,
    mainFile: file,
    agentFiles: [],
    workflowRuns: [],
  };
  return { discovered, main, agents: [], agentMeta: {}, workflowRuns: [] };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cca-search-'));
  const dbPath = join(root, 'index.sqlite');
  const sessions = SESSION_IDS.map(sessionFor);
  await runIndex({
    roots: [root],
    dbPath,
    pricing,
    discover: async () => sessions.map((s) => s.discovered),
    parse: async (d) => sessions.find((s) => s.discovered.sessionId === d.sessionId)!,
  });
  store = createStore(dbPath);
});

afterAll(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('content search paging', () => {
  it('reaches every matching session, one page at a time', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await store.search({ q: 'pipeline', limit: 2, ...(cursor ? { cursor } : {}) }, ctx);
      seen.push(...page.groups.map((g) => g.session.id));
      pages += 1;
      expect(pages).toBeLessThan(SESSION_COUNT + 2);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(new Set(seen).size).toBe(SESSION_COUNT);
    expect(seen).toHaveLength(SESSION_COUNT);
  });

  it('reports every matching session in totalSessions, not just the ones the window reached', async () => {
    const page = await store.search({ q: 'pipeline', limit: 2 }, ctx);
    expect(page.totalSessions).toBe(SESSION_COUNT);
    expect(page.groups).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it('caps displayed hits at three while hitCount keeps the exact total', async () => {
    const page = await store.search({ q: 'pipeline', limit: 2 }, ctx);
    for (const group of page.groups) {
      expect(group.hits).toHaveLength(3);
      expect(group.hitCount).toBe(MESSAGES_PER_SESSION);
    }
  });

  it('narrows, never widens, when a filter is added', async () => {
    const all = await store.search({ q: 'pipeline', limit: 5 }, ctx);
    const filtered = await store.search({ q: 'pipeline', limit: 5, kinds: ['prompt'] }, ctx);
    const wrongKind = await store.search({ q: 'pipeline', limit: 5, kinds: ['tool_result'] }, ctx);
    expect(filtered.totalSessions).toBe(all.totalSessions);
    expect(wrongKind.totalSessions).toBe(0);
    const outOfRange = await store.search({ q: 'pipeline', limit: 5, from: '2020-01-01', to: '2020-01-02' }, ctx);
    expect(outOfRange.totalSessions).toBe(0);
  });

  it('is deterministic and never repeats a session inside a page', async () => {
    const runs = await Promise.all([
      store.search({ q: 'pipeline', limit: 4 }, ctx),
      store.search({ q: 'pipeline', limit: 4 }, ctx),
      store.search({ q: 'pipeline', limit: 4 }, ctx),
    ]);
    const ids = runs.map((r) => r.groups.map((g) => g.session.id).join(','));
    expect(new Set(ids).size).toBe(1);
    expect(new Set(runs[0]!.groups.map((g) => g.session.id)).size).toBe(4);
  });

  it('stops cleanly when nothing matches', async () => {
    const page = await store.search({ q: 'zzzznotinthecorpus', limit: 5 }, ctx);
    expect(page.groups).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.totalSessions).toBe(0);
  });
});

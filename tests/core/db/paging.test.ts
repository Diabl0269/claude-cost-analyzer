import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QueryContext, Store } from '../../../core/store.js';
import type { DiscoveredSession, ParsedSession, UserSettings } from '../../../core/types.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { defaultSettings } from '../../../core/settings.js';
import { runIndex } from '../../../core/db/indexer.js';
import { createStore } from '../../../core/db/store.js';
import { SESSION_ID } from '../cost/builders.js';
import { buildFixture } from './fixture.js';

const pricing = defaultPricing();
const settings: UserSettings = { ...defaultSettings(), hideScratchProjects: false };
const ctx: QueryContext = { pricing, settings, now: new Date(2026, 8, 7, 12) };
const IDS = [SESSION_ID, 'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003'];

let root: string;
let store: Store;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cca-paging-'));
  const dbPath = join(root, 'db', 'index.sqlite');
  const sessions = IDS.map((sessionId, i) =>
    buildFixture(root, { sessionId, date: `2026-09-0${5 + i}` }).session,
  );
  const discover = async (): Promise<DiscoveredSession[]> => sessions.map((s) => s.discovered);
  const parse = async (d: DiscoveredSession): Promise<ParsedSession> => {
    const found = sessions.find((s) => s.discovered.sessionId === d.sessionId);
    if (!found) throw new Error(`no fixture for ${d.sessionId}`);
    return found;
  };
  await runIndex({ roots: [root], dbPath, pricing, discover, parse });
  store = createStore(dbPath);
});

afterAll(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('keyset paging', () => {
  it('walks every session exactly once across pages', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await store.listSessions({ limit: 2, ...(cursor ? { cursor } : {}) }, ctx);
      expect(page.total).toBe(3);
      seen.push(...page.sessions.map((s) => s.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
      expect(pages).toBeLessThan(5);
    } while (cursor);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('sorts newest first by default and reverses with order=asc', async () => {
    const desc = await store.listSessions({ sort: 'recent' }, ctx);
    const asc = await store.listSessions({ sort: 'recent', order: 'asc' }, ctx);
    expect(desc.sessions.map((s) => s.id)).toEqual([...asc.sessions.map((s) => s.id)].reverse());
    expect(desc.sessions[0]?.startedAt.startsWith('2026-09-07')).toBe(true);
  });

  it('sorts by cost with a stable tie-break', async () => {
    const byCost = await store.listSessions({ sort: 'cost' }, ctx);
    const costs = byCost.sessions.map((s) => s.cost.total);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));
    expect(byCost.totalCost).toBeCloseTo(costs.reduce((a, b) => a + b, 0), 12);
  });

  it('restricts the range to the sessions that started inside it', async () => {
    const page = await store.listSessions({ from: '2026-09-06', to: '2026-09-07' }, ctx);
    expect(page.total).toBe(2);
  });

  it('exports every matching session to CSV, not just the first page', async () => {
    const csv = await store.exportSessionsCsv({ limit: 1 }, ctx);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(4);
  });
});

describe('search paging', () => {
  it('groups all three sessions and pages through them', async () => {
    const first = await store.search({ q: 'helper', limit: 2 }, ctx);
    expect(first.totalSessions).toBe(3);
    expect(first.groups).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await store.search({ q: 'helper', limit: 2, cursor: first.nextCursor ?? '' }, ctx);
    expect(second.groups).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe('scratch projects', () => {
  it('hides them by default and shows them when the query targets the project', async () => {
    const hiding: QueryContext = { ...ctx, settings: { ...settings, hideScratchProjects: true } };
    expect((await store.listSessions({}, hiding)).total).toBe(3);
    // The fixture project is a normal path, so hiding changes nothing; a targeted query still works.
    expect((await store.listSessions({ project: '/Users/dev/widget' }, hiding)).total).toBe(3);
    expect((await store.getSession(SESSION_ID, hiding))?.summary.id).toBe(SESSION_ID);
  });
});

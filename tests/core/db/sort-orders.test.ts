/**
 * `sort=requests` and `sort=tools` for GET /api/sessions. Both are ties in the shared fixture, so
 * this file builds three sessions that differ in exactly one of the two counts — otherwise a
 * mapping that read the wrong field would still pass. The order also has to survive cursor
 * paging: each session appears once, in the same sequence a single unpaged call returns.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QueryContext, Store } from '../../../core/store.js';
import type { DiscoveredSession, ParsedSession, SessionSort, UserSettings } from '../../../core/types.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { defaultSettings } from '../../../core/settings.js';
import { runIndex } from '../../../core/db/indexer.js';
import { createStore } from '../../../core/db/store.js';
import { buildFixture } from './fixture.js';

const pricing = defaultPricing();
const settings: UserSettings = { ...defaultSettings(), hideScratchProjects: false };
const ctx: QueryContext = { pricing, settings, now: new Date(2026, 8, 7, 12) };

const FULL = 'aaaaaaaa-0000-0000-0000-00000000000a';
const FEW_REQUESTS = 'bbbbbbbb-0000-0000-0000-00000000000b';
const FEW_TOOLS = 'cccccccc-0000-0000-0000-00000000000c';

let root: string;
let store: Store;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cca-sort-orders-'));
  const dbPath = join(root, 'db', 'index.sqlite');

  const full = buildFixture(root, { sessionId: FULL, date: '2026-09-05' }).session;

  // One request fewer than the others (its assistant line goes with it).
  const fewRequests = buildFixture(root, { sessionId: FEW_REQUESTS, date: '2026-09-06' }).session;
  fewRequests.main.requests = fewRequests.main.requests.filter((request) => request.seq !== 6);
  fewRequests.main.messages = fewRequests.main.messages.filter((message) => message.requestSeq !== 6);

  // One tool call fewer than the others.
  const fewTools = buildFixture(root, { sessionId: FEW_TOOLS, date: '2026-09-07' }).session;
  fewTools.main.toolCalls = fewTools.main.toolCalls.filter((call) => call.toolUseId !== 'toolu_a');

  const sessions = [full, fewRequests, fewTools];
  const discover = async (): Promise<DiscoveredSession[]> => sessions.map((session) => session.discovered);
  const parse = async (discovered: DiscoveredSession): Promise<ParsedSession> => {
    const found = sessions.find((session) => session.discovered.sessionId === discovered.sessionId);
    if (!found) throw new Error(`no fixture for ${discovered.sessionId}`);
    return found;
  };
  await runIndex({ roots: [root], dbPath, pricing, discover, parse });
  store = createStore(dbPath);
});

afterAll(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

/** Walks every page of a sort and returns the ids in the order the pages produced them. */
async function walk(sort: SessionSort): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await store.listSessions({ sort, limit: 2, ...(cursor ? { cursor } : {}) }, ctx);
    seen.push(...page.sessions.map((session) => session.id));
    cursor = page.nextCursor ?? undefined;
    pages += 1;
    expect(pages).toBeLessThan(5);
  } while (cursor);
  return seen;
}

describe('listSessions sort=requests', () => {
  it('orders by billed request count, most first', async () => {
    const page = await store.listSessions({ sort: 'requests' }, ctx);
    const counts = page.sessions.map((session) => session.requestCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(page.sessions[page.sessions.length - 1]?.id).toBe(FEW_REQUESTS);
  });

  it('reverses with order=asc and pages each session exactly once', async () => {
    const desc = await store.listSessions({ sort: 'requests' }, ctx);
    const asc = await store.listSessions({ sort: 'requests', order: 'asc' }, ctx);
    expect(asc.sessions.map((session) => session.id)).toEqual([...desc.sessions.map((session) => session.id)].reverse());
    expect(await walk('requests')).toEqual(desc.sessions.map((session) => session.id));
  });
});

describe('listSessions sort=tools', () => {
  it('orders by tool-call count, most first', async () => {
    const page = await store.listSessions({ sort: 'tools' }, ctx);
    const counts = page.sessions.map((session) => session.toolCallCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(page.sessions[page.sessions.length - 1]?.id).toBe(FEW_TOOLS);
  });

  it('reverses with order=asc and pages each session exactly once', async () => {
    const desc = await store.listSessions({ sort: 'tools' }, ctx);
    const asc = await store.listSessions({ sort: 'tools', order: 'asc' }, ctx);
    expect(asc.sessions.map((session) => session.id)).toEqual([...desc.sessions.map((session) => session.id)].reverse());
    expect(await walk('tools')).toEqual(desc.sessions.map((session) => session.id));
  });

  it('is a different order from sort=requests, so the two read different fields', async () => {
    const byRequests = await store.listSessions({ sort: 'requests' }, ctx);
    const byTools = await store.listSessions({ sort: 'tools' }, ctx);
    expect(byTools.sessions.map((session) => session.id)).not.toEqual(byRequests.sessions.map((session) => session.id));
  });
});

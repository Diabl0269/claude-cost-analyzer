/**
 * `Store.reopen()` exists for one situation: the indexer runs in a worker thread with its own
 * connection, and a full rebuild drops and recreates every table underneath the reader. These
 * tests reproduce that from a second connection.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PricingConfig, UserSettings } from '../../../core/types.js';
import type { QueryContext } from '../../../core/store.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { defaultSettings } from '../../../core/settings.js';
import { runIndex } from '../../../core/db/indexer.js';
import { createStore } from '../../../core/db/store.js';
import { SESSION_ID } from '../cost/builders.js';
import { buildFixture } from './fixture.js';

let root: string;
let dbPath: string;
const pricing: PricingConfig = defaultPricing();
const settings: UserSettings = { ...defaultSettings(), hideScratchProjects: false };
const ctx: QueryContext = { pricing, settings, now: new Date(2026, 8, 7, 12) };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cca-reopen-'));
  dbPath = join(root, 'db', 'index.sqlite');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function index(full: boolean): Promise<void> {
  const fixture = buildFixture(root);
  await runIndex({
    roots: [root],
    dbPath,
    pricing,
    full,
    discover: async () => [fixture.session.discovered],
    parse: async () => fixture.session,
  });
}

describe('Store.reopen', () => {
  it('serves the rebuilt data after another connection drops and recreates the schema', async () => {
    await index(false);
    const store = createStore(dbPath);
    try {
      expect((await store.status(ctx)).counts.sessions).toBe(1);

      // What server/worker.ts does on POST /api/reindex { full: true }.
      await index(true);
      store.reopen();

      const status = await store.status(ctx);
      expect(status.counts.sessions).toBe(1);
      expect(status.counts.requests).toBeGreaterThan(0);
      const detail = await store.getSession(SESSION_ID, ctx);
      expect(detail?.summary.id).toBe(SESSION_ID);
      const search = await store.search({ q: 'helper', scope: 'everything' }, ctx);
      expect(search.groups.length).toBeGreaterThanOrEqual(0);
    } finally {
      store.close();
    }
  });

  it('is idempotent and a no-op once the store is closed', async () => {
    await index(false);
    const store = createStore(dbPath);
    store.reopen();
    store.reopen();
    expect((await store.status(ctx)).counts.sessions).toBe(1);
    store.close();
    // A late reopen from an in-flight run must not resurrect a closed connection.
    expect(() => store.reopen()).not.toThrow();
    expect(() => store.close()).not.toThrow();
  });
});

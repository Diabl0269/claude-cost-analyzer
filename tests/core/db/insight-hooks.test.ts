/**
 * `buildInsightsInput` has to carry `hookEvent` through, or an unnamed hook reaches the insights
 * as a bare `(unnamed)` and gets described as "an unnamed hook" when the transcript said which
 * event it ran on. The phrasing itself is covered in tests/core/cost/insights.test.ts; this test
 * is the wiring from the indexed `hook_runs` row to that sentence.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DiscoveredSession, ParsedSession, UserSettings } from '../../../core/types.js';
import type { QueryContext, Store } from '../../../core/store.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { defaultSettings } from '../../../core/settings.js';
import { runIndex } from '../../../core/db/indexer.js';
import { createStore } from '../../../core/db/store.js';
import { TS, buildFixture } from './fixture.js';

const pricing = defaultPricing();
const settings: UserSettings = { ...defaultSettings(), hideScratchProjects: false };
const ctx: QueryContext = { pricing, settings, now: new Date(2026, 8, 7, 12) };

let root: string;
let store: Store;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cca-insight-hooks-'));
  const fixture = buildFixture(root);
  // A bare `stop_hook_summary`: a duration and a command, no hook name.
  fixture.session.main.hooks = [
    {
      seq: 2,
      turnIndex: 0,
      ts: TS(2),
      kind: 'stop_summary',
      hookEvent: 'Stop',
      command: '/usr/local/bin/notify-stop.sh',
      durationMs: 9_000,
      injectedChars: 0,
    },
  ];
  const discover = async (): Promise<DiscoveredSession[]> => [fixture.discovered];
  const parse = async (): Promise<ParsedSession> => fixture.session;
  await runIndex({ roots: [root], dbPath: join(root, 'db', 'index.sqlite'), pricing, discover, parse });
  store = createStore(join(root, 'db', 'index.sqlite'));
});

afterAll(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('insights hooks', () => {
  it('describes an unnamed hook by its event rather than by the placeholder', async () => {
    const { insights } = await store.insights({}, ctx);
    const slow = insights.find((insight) => insight.id === 'slow-hooks');
    expect(slow?.title).toMatch(/^An unnamed Stop hook spent /);
    expect(slow?.title).not.toContain('(unnamed)');
  });

  it('keeps the hook analytics row own event and display name', async () => {
    const hooks = await store.hooksAnalytics({}, ctx);
    expect(hooks.hooks[0]?.hookEvent).toBe('Stop');
    expect(hooks.hooks[0]?.displayName).toBe('Stop · notify-stop.sh');
  });
});

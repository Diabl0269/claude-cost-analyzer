import { describe, expect, it } from 'vitest';
import { discoverSessions } from '../../../core/discover.js';
import { parseSession } from '../../../core/parse/index.js';
import type { ParsedTranscript } from '../../../core/types.js';
import { FIXTURE_ROOT } from './helpers.js';

/** SPEC §5.2 defaults, USD per MTok: input, output, write5m, write1h, read. */
const PRICES: Record<string, [number, number, number, number, number]> = {
  'claude-opus-5': [5, 25, 6.25, 10, 0.5],
  'claude-opus-4-8': [5, 25, 6.25, 10, 0.5],
  'claude-sonnet-5': [2, 10, 2.5, 4, 0.2],
  'claude-haiku-4-5-20251001': [1, 5, 1.25, 2, 0.1],
  'claude-fable-5-1': [10, 50, 12.5, 20, 0.25],
  '<synthetic>': [0, 0, 0, 0, 0],
};

interface Totals {
  sessions: number; transcripts: number; lines: number; messages: number; assistantLines: number;
  requests: number; synthetic: number; toolCalls: number; hookRuns: number; injections: number;
  injectedChars: number; compactions: number; apiErrors: number; parseErrors: number;
  costBySession: Record<string, number>; costByModel: Record<string, number>; totalCost: number;
}

async function fixtureTotals(): Promise<Totals> {
  const t: Totals = {
    sessions: 0, transcripts: 0, lines: 0, messages: 0, assistantLines: 0, requests: 0,
    synthetic: 0, toolCalls: 0, hookRuns: 0, injections: 0, injectedChars: 0, compactions: 0,
    apiErrors: 0, parseErrors: 0, costBySession: {}, costByModel: {}, totalCost: 0,
  };
  for (const discovered of await discoverSessions([FIXTURE_ROOT])) {
    const parsed = await parseSession(discovered);
    const all: ParsedTranscript[] = [parsed.main, ...parsed.agents, ...parsed.workflowRuns.flatMap((r) => r.agents)];
    t.sessions += 1;
    let sessionCost = 0;
    for (const transcript of all) {
      t.transcripts += 1;
      t.lines += transcript.meta.lineCount;
      t.parseErrors += transcript.meta.parseErrors;
      t.messages += transcript.messages.length;
      t.assistantLines += transcript.messages.filter((m) => m.role === 'assistant').length;
      t.requests += transcript.requests.length;
      t.synthetic += transcript.requests.filter((r) => r.isSynthetic).length;
      t.toolCalls += transcript.toolCalls.length;
      t.hookRuns += transcript.hooks.length;
      t.injections += transcript.injections.length;
      t.compactions += transcript.compactions.length;
      t.apiErrors += transcript.apiErrors.length;
      for (const injection of transcript.injections) t.injectedChars += injection.chars;
      for (const request of transcript.requests) {
        const units = request.iterations ?? [{ model: request.model, usage: request.usage }];
        for (const unit of units) {
          const p = PRICES[unit.model];
          if (!p) throw new Error(`fixture uses an unpriced model: ${unit.model}`);
          const u = unit.usage;
          const cost = (u.input * p[0] + u.output * p[1] + u.cache5m * p[2] + u.cache1h * p[3] + u.cacheRead * p[4]) / 1e6;
          sessionCost += cost;
          t.costByModel[unit.model] = (t.costByModel[unit.model] ?? 0) + cost;
        }
      }
    }
    t.costBySession[discovered.sessionId] = sessionCost;
    t.totalCost += sessionCost;
  }
  return t;
}

const round = (n: number): number => Number(n.toFixed(6));

describe('fixture totals (tests/fixtures/README.md)', () => {
  it('matches the documented counts', async () => {
    const t = await fixtureTotals();
    expect({
      sessions: t.sessions, transcripts: t.transcripts, lines: t.lines, messages: t.messages,
      assistantLines: t.assistantLines, requests: t.requests, synthetic: t.synthetic,
      toolCalls: t.toolCalls, hookRuns: t.hookRuns, injections: t.injections,
      injectedChars: t.injectedChars, compactions: t.compactions, apiErrors: t.apiErrors,
      parseErrors: t.parseErrors,
    }).toEqual({
      sessions: 5, transcripts: 10, lines: 64, messages: 55, assistantLines: 23, requests: 20,
      synthetic: 1, toolCalls: 7, hookRuns: 5, injections: 20, injectedChars: 833,
      compactions: 1, apiErrors: 1, parseErrors: 0,
    });
  });

  it('matches the documented cost per session at SPEC §5.2 prices', async () => {
    const t = await fixtureTotals();
    const rounded = Object.fromEntries(Object.entries(t.costBySession).map(([k, v]) => [k.slice(0, 8), round(v)]));
    expect(rounded).toEqual({
      a1111111: 0.1843,    // equals this session's own cost-state totalCostUSD
      a2222222: 0.131251,
      a3333333: 0.070446,
      b1111111: 0.013108,
      c1111111: 0.000022,
    });
    expect(round(t.totalCost)).toBe(0.399127);
  });

  it('matches the documented cost per model', async () => {
    const t = await fixtureTotals();
    expect(Object.fromEntries(Object.entries(t.costByModel).map(([k, v]) => [k, round(v)]))).toEqual({
      'claude-opus-5': 0.273275,
      'claude-sonnet-5': 0.071192,
      'claude-haiku-4-5-20251001': 0.01338,
      'claude-opus-4-8': 0.02876,
      'claude-fable-5-1': 0.01252,
      '<synthetic>': 0,
    });
  });
});

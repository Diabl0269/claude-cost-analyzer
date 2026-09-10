import { beforeEach, describe, expect, it } from 'vitest';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { STANDARD_FLAGS, createPriceResolver, resolvePrice } from '../../../core/pricing/resolve.js';
import { billedUsage, requestCost } from '../../../core/pricing/money.js';
import {
  avgContextPrice,
  buildPriceIndex,
  newTokenPrice,
  priceItem,
  priceRequests,
  toolCallCosts,
  type PricedRequestInput,
} from '../../../core/cost/price-at-read.js';
import { attributeTranscript, attributionByRef } from '../../../core/cost/attribution.js';
import type { ContextEstMethod, EstMethod } from '../../../core/types.js';
import { block, injection, request, resetClock, toolCall, transcript, usage } from './builders.js';

const pricing = defaultPricing();

/** Gap items never use the context-item-only method, so narrowing is safe here. */
function gapMethod(method: ContextEstMethod): EstMethod {
  return method === 'exact-output' ? 'none' : method;
}

beforeEach(resetClock);

function priced(seq: number, u: Parameters<typeof usage>[0], model = 'claude-opus-5'): PricedRequestInput {
  const full = usage(u);
  return {
    seq,
    usage: full,
    contextTokens: full.input + full.cacheRead + full.cache5m + full.cache1h,
    resolved: resolvePrice(model, STANDARD_FLAGS, pricing),
  };
}

describe('blended prices', () => {
  it('newTokenPrice weights input and both cache-write TTLs', () => {
    const req = priced(0, { input: 100, cache5m: 300, cache1h: 100 });
    const expected = (100 * 5 + 300 * 6.25 + 100 * 10) / 1e6 / 500;
    expect(newTokenPrice(req, req.resolved)).toBeCloseTo(expected, 15);
  });

  it('newTokenPrice falls back to the input price when nothing new was written', () => {
    const req = priced(0, { cacheRead: 900 });
    expect(newTokenPrice(req, req.resolved)).toBeCloseTo(5 / 1e6, 15);
  });

  it('avgContextPrice divides the whole context bill by the context size', () => {
    const req = priced(0, { input: 100, cache5m: 400, cacheRead: 9500 });
    const expected = (100 * 5 + 400 * 6.25 + 9500 * 0.5) / 1e6 / 10_000;
    expect(avgContextPrice(req, req.resolved)).toBeCloseTo(expected, 15);
  });

  it('avgContextPrice is zero for an empty context', () => {
    const req = priced(0, {});
    expect(avgContextPrice(req, req.resolved)).toBe(0);
  });
});

describe('prefix sums', () => {
  const requests = [
    priced(0, { input: 1000 }),
    priced(2, { input: 200, cache5m: 1800, cacheRead: 1000 }),
    priced(4, { input: 100, cacheRead: 3000 }),
    priced(6, { input: 50, cache1h: 900, cacheRead: 4000 }),
    priced(8, { input: 10, cacheRead: 5000 }),
  ];
  const index = buildPriceIndex(requests);

  function bruteForceCarry(tokens: number, ingestSeq: number, lastCarrySeq: number): number {
    let sum = 0;
    for (const req of requests) {
      if (req.seq > ingestSeq && req.seq <= lastCarrySeq) sum += avgContextPrice(req, req.resolved);
    }
    return tokens * sum;
  }

  it('matches a brute-force carry sum for every range', () => {
    for (const ingest of requests) {
      for (const last of requests) {
        if (last.seq <= ingest.seq) continue;
        const result = priceItem(
          { tokens: 1234, estMethod: 'delta', ingestRequestSeq: ingest.seq, lastCarrySeq: last.seq },
          index,
        );
        expect(result.carryCost).toBeCloseTo(bruteForceCarry(1234, ingest.seq, last.seq), 15);
      }
    }
  });

  it('prices ingest against the ingesting request only', () => {
    const target = requests[1];
    expect(target).toBeDefined();
    if (!target) return;
    const result = priceItem(
      { tokens: 500, estMethod: 'delta', ingestRequestSeq: 2, lastCarrySeq: null },
      index,
    );
    expect(result.ingestCost).toBeCloseTo(500 * newTokenPrice(target, target.resolved), 15);
    expect(result.carryCost).toBe(0);
    expect(result.carryRequests).toBe(0);
  });

  it('counts the number of carrying requests', () => {
    const result = priceItem(
      { tokens: 1, estMethod: 'delta', ingestRequestSeq: 0, lastCarrySeq: 8 },
      index,
    );
    expect(result.carryRequests).toBe(4);
  });

  it('costs nothing when the item was never ingested', () => {
    const result = priceItem(
      { tokens: 900, estMethod: 'heuristic', ingestRequestSeq: null, lastCarrySeq: null },
      index,
    );
    expect(result.ingestCost).toBe(0);
    expect(result.carryCost).toBe(0);
  });
});

describe('priceRequests', () => {
  it('flags cold-cache requests and computes the cache hit ratio', () => {
    const costs = priceRequests(
      [
        request({ seq: 0, usage: usage({ input: 30_000, output: 100 }), contextTokens: 30_000 }),
        request({
          seq: 2,
          usage: usage({ input: 100, cacheRead: 29_900, output: 100 }),
          contextTokens: 30_000,
        }),
      ],
      pricing,
    );
    expect(costs[0]?.coldCache).toBe(true);
    expect(costs[0]?.cacheHitRatio).toBe(0);
    expect(costs[1]?.coldCache).toBe(false);
    expect(costs[1]?.cacheHitRatio).toBeCloseTo(29_900 / 30_000, 12);
  });

  it('excludes synthetic messages', () => {
    const costs = priceRequests(
      [
        request({ seq: 0, usage: usage({ input: 10 }) }),
        request({ seq: 1, model: '<synthetic>', isSynthetic: true }),
      ],
      pricing,
    );
    expect(costs).toHaveLength(1);
  });

  it('carries tool names through for the transcript view', () => {
    const costs = priceRequests(
      [
        request({
          seq: 0,
          usage: usage({ input: 10, output: 10 }),
          blocks: [block({ type: 'tool_use', chars: 20, toolUseId: 'toolu_a', toolName: 'Bash' })],
        }),
      ],
      pricing,
    );
    expect(costs[0]?.toolNames).toEqual(['Bash']);
  });
});

describe('fallback iterations', () => {
  const fallbackRequest = request({
    seq: 0,
    model: 'claude-opus-4-8',
    usage: usage({ input: 100, output: 200 }),
    iterations: [
      { model: 'claude-fable-5', usage: usage({ input: 50, output: 20 }), type: 'fallback_message' },
      { model: 'claude-opus-4-8', usage: usage({ input: 100, output: 200 }), type: 'message' },
    ],
    isFallback: true,
  });

  it('bills each iteration at its own model', () => {
    const result = requestCost(fallbackRequest, pricing);
    const fable = (50 * 10 + 20 * 50) / 1e6;
    const opus = (100 * 5 + 200 * 25) / 1e6;
    expect(result.perIteration).toHaveLength(2);
    expect(result.cost.total).toBeCloseTo(fable + opus, 15);
    expect(result.resolved.modelKey).toBe('opus-4.8');
  });

  it('reports the summed billed usage', () => {
    expect(billedUsage(fallbackRequest).output).toBe(220);
    expect(billedUsage(request({ seq: 1, usage: usage({ output: 7 }) })).output).toBe(7);
  });

  it('bills a single-iteration request from the top-level usage', () => {
    const single = request({
      seq: 0,
      usage: usage({ input: 100, output: 200 }),
      iterations: [{ model: 'claude-opus-5', usage: usage({ input: 100, output: 200 }), type: 'message' }],
    });
    const result = requestCost(single, pricing);
    expect(result.perIteration).toBeUndefined();
    expect(result.cost.total).toBeCloseTo((100 * 5 + 200 * 25) / 1e6, 15);
  });
});

describe('toolCallCosts', () => {
  it('adds generation, ingest and carry into ownCost and leaves childCost to the store', () => {
    const t = transcript({
      requests: [
        request({
          seq: 0,
          usage: usage({ input: 1000, output: 1000 }),
          contextTokens: 1000,
          blocks: [block({ type: 'tool_use', chars: 100, toolUseId: 'toolu_a', toolName: 'Read' })],
        }),
        request({ seq: 2, usage: usage({ input: 2000 }), contextTokens: 2000 }),
        request({ seq: 3, usage: usage({ input: 100, cacheRead: 2900 }), contextTokens: 3000 }),
      ],
      toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0, resultSeq: 1, resultChars: 3100 })],
    });
    const attribution = attributeTranscript(t, pricing);
    const fact = attributionByRef(attribution).get('toolu_a');
    expect(fact).toBeDefined();
    if (!fact) return;

    const resolve = createPriceResolver(pricing);
    const index = buildPriceIndex(
      t.requests.map((r) => ({
        seq: r.seq,
        usage: r.usage,
        contextTokens: r.contextTokens,
        resolved: resolve(r.model, STANDARD_FLAGS),
      })),
    );
    const genTokens = attribution.outputShares.get(0)?.toolUseTokens.get('toolu_a') ?? 0;
    const [cost] = toolCallCosts(
      [
        {
          toolUseId: 'toolu_a',
          agentId: null,
          name: 'Read',
          requestSeq: 0,
          resultSeq: 1,
          turnIndex: 0,
          ts: '2026-09-07T09:00:00.000Z',
          inputSummary: 'read',
          inputChars: 40,
          resultChars: 3100,
          resultShape: 'string',
          isError: false,
          genTokens,
          tokens: fact.tokens,
          estMethod: gapMethod(fact.estMethod),
          ingestRequestSeq: fact.ingestRequestSeq,
          lastCarrySeq: fact.lastCarrySeq,
        },
      ],
      () => index,
    );
    expect(cost).toBeDefined();
    if (!cost) return;
    expect(cost.genCost).toBeCloseTo(1000 * (25 / 1e6), 15);
    expect(cost.result.ingestCost).toBeGreaterThan(0);
    expect(cost.result.carryCost).toBeGreaterThan(0);
    expect(cost.ownCost).toBeCloseTo(cost.genCost + cost.result.ingestCost + cost.result.carryCost, 15);
    expect(cost.childCost).toBeNull();
  });
});

describe('injection pricing', () => {
  it('prices a harness attachment through the same path as tool results', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 2, usage: usage({ input: 1310 }), contextTokens: 1310 }),
      ],
      injections: [injection({ seq: 1, chars: 961 })],
    });
    const item = attributeTranscript(t, pricing).items[0];
    expect(item).toBeDefined();
    if (!item) return;
    const resolve = createPriceResolver(pricing);
    const index = buildPriceIndex(
      t.requests.map((r) => ({
        seq: r.seq,
        usage: r.usage,
        contextTokens: r.contextTokens,
        resolved: resolve(r.model, STANDARD_FLAGS),
      })),
    );
    const cost = priceItem({ ...item, estMethod: gapMethod(item.estMethod) }, index);
    expect(cost.ingestCost).toBeCloseTo(item.tokens * (5 / 1e6), 15);
  });
});

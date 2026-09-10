/**
 * Spend-by-model rows must count "requests" per model as billed iterations attributed to that
 * model (docs/METHODOLOGY.md §2), so a fallback request — billed under two models — shows a
 * non-zero request count next to its non-zero cost on both models' rows, not just the final one.
 */
import { describe, expect, it } from 'vitest';
import { groupModelRows } from '../../../core/db/sessions.js';
import { createPriceResolver } from '../../../core/pricing/resolve.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import type { Row } from '../../../core/db/rows.js';

const pricing = defaultPricing();
const resolve = createPriceResolver(pricing);

function row(model: string, opts: { requests: number; billedRequests: number; input: number }): Row {
  return {
    model,
    speed: 'standard',
    serviceTier: 'standard',
    inferenceGeo: 'global',
    input: opts.input,
    output: 0,
    cacheRead: 0,
    cache5m: 0,
    cache1h: 0,
    cacheAssumed: 0,
    thinking: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    contextTokens: 0,
    requests: opts.requests,
    billedRequests: opts.billedRequests,
  };
}

describe('groupModelRows', () => {
  it('counts a fallback iteration as a request for the model it billed under, not just the top-level model', () => {
    // One user-visible request, billed as: iterIndex 0 (opus, the final/canonical iteration,
    // counted in `requests`) + iterIndex 1 (fable, the earlier fallback iteration, NOT counted in
    // `requests` but IS a separate row grouped under its own model — see write-session.ts).
    const rows: Row[] = [
      row('claude-opus-5', { requests: 1, billedRequests: 1, input: 100 }),
      row('claude-fable-5', { requests: 0, billedRequests: 1, input: 40 }),
    ];
    const byModel = groupModelRows(rows, resolve, pricing);
    const opus = byModel.find((m) => m.model === 'claude-opus-5');
    const fable = byModel.find((m) => m.model === 'claude-fable-5');
    expect(opus?.requests).toBe(1);
    // The bug: fable's row previously reported `requests: 0` beside its non-zero cost because
    // `requests` only counted iterIndex 0. Now it uses `billedRequests` and reports 1.
    expect(fable?.requests).toBe(1);
    expect(fable?.cost.total).toBeGreaterThan(0);
    // Per-model requests can sum to more than the session's actual single request — documented.
    expect((opus?.requests ?? 0) + (fable?.requests ?? 0)).toBe(2);
  });

  it('falls back to the exact `requests` column when `billedRequests` is absent', () => {
    const rows: Row[] = [{ ...row('claude-opus-5', { requests: 1, billedRequests: 1, input: 100 }) }];
    delete (rows[0] as Record<string, unknown>).billedRequests;
    const byModel = groupModelRows(rows, resolve, pricing);
    expect(byModel[0]?.requests).toBe(1);
  });
});

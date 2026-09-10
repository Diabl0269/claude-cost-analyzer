import { describe, expect, it } from 'vitest';
import {
  compareReported,
  computedTokenClasses,
  deltaPct,
  reportedTokenClasses,
  type TokenClassTotals,
} from '../../../core/cost/reported.js';
import type { ReportedCost, ReportedModelUsage, TokenTotals } from '../../../core/types.js';

function usage(partial: Partial<ReportedModelUsage>): ReportedModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
    ...partial,
  };
}

function reported(totalCostUSD: number, modelUsage: Record<string, ReportedModelUsage>): ReportedCost {
  return { totalCostUSD, modelUsage };
}

function computed(partial: Partial<TokenClassTotals>): TokenClassTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...partial };
}

/**
 * A realistically shaped session: everything is cache traffic, and plain `input` is a couple of
 * dozen tokens — small enough to sit under the significance floor, exactly as on real data.
 */
function bigSession(scale: number): TokenClassTotals {
  return { input: 40 * scale, output: 50_000 * scale, cacheRead: 900_000 * scale, cacheWrite: 200_000 * scale };
}

function asReported(classes: TokenClassTotals, usd: number): ReportedCost {
  return reported(usd, {
    'claude-opus-5[1m]': usage({
      inputTokens: classes.input,
      outputTokens: classes.output,
      cacheReadInputTokens: classes.cacheRead,
      cacheCreationInputTokens: classes.cacheWrite,
      costUSD: usd,
    }),
  });
}

describe('deltaPct', () => {
  it('is zero when both sides are zero', () => {
    expect(deltaPct(0, 0)).toBe(0);
  });

  it('is +100% when only the computed side has tokens and -100% when only the reported side does', () => {
    expect(deltaPct(500, 0)).toBe(100);
    expect(deltaPct(0, 500)).toBe(-100);
  });

  it('normalises by the larger side so it stays bounded', () => {
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(100, 50)).toBe(50);
  });
});

describe('reportedTokenClasses', () => {
  it('sums every model and never folds thinking tokens into output', () => {
    const totals = reportedTokenClasses(
      reported(1, {
        'claude-opus-5[1m]': usage({
          inputTokens: 10,
          outputTokens: 100,
          thinkingTokens: 90,
          cacheReadInputTokens: 1_000,
          cacheCreationInputTokens: 200,
        }),
        'claude-haiku-4-5-20251001': usage({ inputTokens: 1_600, outputTokens: 15 }),
      }),
    );
    expect(totals).toEqual({ input: 1_610, output: 115, cacheRead: 1_000, cacheWrite: 200 });
  });
});

describe('computedTokenClasses', () => {
  it('collapses the two cache-write TTLs into one class', () => {
    const tokens: TokenTotals = {
      input: 4,
      output: 8,
      cacheRead: 16,
      cache5m: 32,
      cache1h: 64,
      thinking: 2,
      webSearchRequests: 0,
      context: 116,
    };
    expect(computedTokenClasses(tokens)).toEqual({ input: 4, output: 8, cacheRead: 16, cacheWrite: 96 });
  });
});

describe('compareReported', () => {
  it('calls identical token counts a match with a zero USD delta', () => {
    const classes = bigSession(1);
    const result = compareReported(classes, 12.5, asReported(classes, 12.5));
    expect(result.status).toBe('match');
    expect(result.deltaPct).toBe(0);
    expect(result.classes).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('ignores an insignificant class: a hidden title-generation call must not break a match', () => {
    const ours = bigSession(1);
    const theirs = { ...ours, input: ours.input + 1_600, output: ours.output + 15 };
    const result = compareReported(ours, 12.4, reported(12.5, {
      'claude-opus-5[1m]': usage({
        inputTokens: ours.input,
        outputTokens: ours.output,
        cacheReadInputTokens: ours.cacheRead,
        cacheCreationInputTokens: ours.cacheWrite,
        costUSD: 12.4,
      }),
      'claude-haiku-4-5-20251001': usage({ inputTokens: 1_600, outputTokens: 15, costUSD: 0.1 }),
    }));
    // The input delta is still reported honestly...
    expect(result.classes.input).toBeCloseTo(deltaPct(ours.input, theirs.input), 6);
    expect(result.classes.input).toBeLessThan(0);
    // ...but 1,600 tokens are below the significance floor, so they do not decide the status.
    expect(result.status).toBe('match');
  });

  it('flags a tally inherited from an earlier process', () => {
    const ours = bigSession(1);
    const theirs = bigSession(4);
    const result = compareReported(ours, 12.5, asReported(theirs, 50));
    expect(result.status).toBe('tally-includes-earlier-process');
    expect(result.deltaPct).toBeCloseTo(-75, 6);
  });

  it('flags a file that covers more than the tally', () => {
    const ours = bigSession(4);
    const theirs = bigSession(1);
    expect(compareReported(ours, 50, asReported(theirs, 12.5)).status).toBe('file-covers-more-than-tally');
  });

  it('flags a tally that only holds hidden background calls', () => {
    const result = compareReported(
      computed({}),
      0,
      reported(0.0021, { 'claude-haiku-4-5-20251001': usage({ inputTokens: 1_600, outputTokens: 15, costUSD: 0.0021 }) }),
    );
    expect(result.status).toBe('hidden-calls-only');
  });

  it('does not call an empty file with real cached usage "hidden calls"', () => {
    const result = compareReported(
      computed({}),
      0,
      asReported({ input: 40, output: 5_000, cacheRead: 800_000, cacheWrite: 90_000 }, 0.239),
    );
    expect(result.status).toBe('tally-includes-earlier-process');
  });

  it('reports classes that diverge in both directions as mixed', () => {
    const ours = { input: 20_000, output: 200_000, cacheRead: 2_000_000, cacheWrite: 400_000 };
    const theirs = { input: 400_000, output: 50_000, cacheRead: 900_000, cacheWrite: 200_000 };
    expect(compareReported(ours, 40, asReported(theirs, 30)).status).toBe('mixed');
  });

  it('judges a session too small for any significant class on its money alone', () => {
    const tiny = { input: 4, output: 100, cacheRead: 900, cacheWrite: 200 };
    expect(compareReported(tiny, 0.01, asReported(tiny, 0.01)).status).toBe('match');
    expect(compareReported(tiny, 0.5, asReported(tiny, 0.01)).status).toBe('file-covers-more-than-tally');
  });
});

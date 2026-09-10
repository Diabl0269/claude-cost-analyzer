import { beforeEach, describe, expect, it } from 'vitest';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import {
  DELTA_RATIO_MAX,
  DELTA_RATIO_MIN,
  attributeTranscript,
  attributionByRef,
} from '../../../core/cost/attribution.js';
import { block, compaction, injection, request, resetClock, toolCall, transcript, usage } from './builders.js';

const pricing = defaultPricing();

beforeEach(resetClock);

describe('output shares', () => {
  it('gives thinking tokens to thinking blocks and splits the rest by chars', () => {
    const t = transcript({
      requests: [
        request({
          seq: 0,
          usage: usage({ input: 100, output: 1000, thinking: 400 }),
          blocks: [
            block({ type: 'thinking', chars: 5000 }),
            block({ type: 'text', chars: 300 }),
            block({ type: 'tool_use', chars: 900, toolUseId: 'toolu_a', toolName: 'Read' }),
          ],
        }),
      ],
      toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0 })],
    });
    const share = attributeTranscript(t, pricing).outputShares.get(0);
    expect(share).toBeDefined();
    if (!share) return;
    expect(share.thinkingTokens).toBe(400);
    // 600 remaining tokens over 1200 chars → 0.5 tokens per char.
    expect(share.textTokens).toBeCloseTo(150, 9);
    expect(share.toolUseTokens.get('toolu_a')).toBeCloseTo(450, 9);
  });

  it('never lets thinking exceed output', () => {
    const t = transcript({
      requests: [request({ seq: 0, usage: usage({ output: 10, thinking: 99 }) })],
    });
    const share = attributeTranscript(t, pricing).outputShares.get(0);
    expect(share?.thinkingTokens).toBe(10);
    expect(share?.textTokens).toBe(0);
  });
});

describe('gap items', () => {
  it('uses the delta estimate when it lands inside the trusted band', () => {
    // R0 context 1000 output 100; R1 context 2100 → Δ = 1000. Item is 3100 chars ≈ 1000 tokens at
    // 3.1 chars/token, so Δ/H = 1.0.
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000, output: 100 }), contextTokens: 1000 }),
        request({ seq: 2, usage: usage({ input: 2100, output: 50 }), contextTokens: 2100 }),
      ],
      toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0, resultSeq: 1, resultChars: 3100 })],
    });
    const item = attributionByRef(attributeTranscript(t, pricing)).get('toolu_a');
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.estMethod).toBe('delta');
    expect(item.tokens).toBeCloseTo(1000, 6);
    expect(item.ingestRequestSeq).toBe(2);
    expect(item.lastCarrySeq).toBeNull();
  });

  it('falls back to the heuristic when Δ/H is outside 0.4–2.5', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000, output: 100 }), contextTokens: 1000 }),
        request({ seq: 2, usage: usage({ input: 11_100 }), contextTokens: 11_100 }),
      ],
      toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0, resultSeq: 1, resultChars: 3100 })],
    });
    const item = attributionByRef(attributeTranscript(t, pricing)).get('toolu_a');
    expect(item?.estMethod).toBe('heuristic');
    expect(item?.tokens).toBeCloseTo(1000, 6);
  });

  it('keeps every delta ratio inside the documented bounds', () => {
    for (const context of [1200, 1400, 2000, 3400, 3600]) {
      const t = transcript({
        requests: [
          request({ seq: 0, usage: usage({ input: 1000, output: 0 }), contextTokens: 1000 }),
          request({ seq: 2, usage: usage({ input: context }), contextTokens: context }),
        ],
        toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0, resultSeq: 1, resultChars: 3100 })],
      });
      const item = attributionByRef(attributeTranscript(t, pricing)).get('toolu_a');
      expect(item).toBeDefined();
      if (!item) continue;
      const ratio = item.tokens / 1000;
      if (item.estMethod === 'delta') {
        expect(ratio).toBeGreaterThanOrEqual(DELTA_RATIO_MIN - 1e-9);
        expect(ratio).toBeLessThanOrEqual(DELTA_RATIO_MAX + 1e-9);
      } else {
        expect(ratio).toBeCloseTo(1, 9);
      }
    }
  });

  it('marks everything before the first request as heuristic', () => {
    const t = transcript({
      requests: [request({ seq: 5, usage: usage({ input: 4000 }), contextTokens: 4000 })],
      injections: [injection({ seq: 0, kind: 'user_prompt', name: 'prompt', chars: 310 })],
    });
    const item = attributeTranscript(t, pricing).items[0];
    expect(item?.estMethod).toBe('heuristic');
    expect(item?.tokens).toBeCloseTo(100, 6);
    expect(item?.ingestRequestSeq).toBe(5);
  });

  it('charges images at 1,600 tokens each', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 2, usage: usage({ input: 2600 }), contextTokens: 2600 }),
      ],
      toolCalls: [
        toolCall({
          toolUseId: 'toolu_img',
          requestSeq: 0,
          resultSeq: 1,
          resultChars: 0,
          resultImages: 2,
          resultShape: 'image',
        }),
      ],
    });
    const item = attributionByRef(attributeTranscript(t, pricing)).get('toolu_img');
    expect(item?.estMethod).toBe('image');
    expect(item?.tokens).toBe(3200);
  });

  it('leaves items after the last request un-ingested', () => {
    const t = transcript({
      requests: [request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 })],
      injections: [injection({ seq: 4, chars: 620 })],
    });
    const item = attributeTranscript(t, pricing).items[0];
    expect(item?.ingestRequestSeq).toBeNull();
    expect(item?.lastCarrySeq).toBeNull();
  });
});

describe('carry ranges', () => {
  it('carries an item to the last request of the transcript', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 2, usage: usage({ input: 2000 }), contextTokens: 2000 }),
        request({ seq: 4, usage: usage({ input: 3000 }), contextTokens: 3000 }),
        request({ seq: 6, usage: usage({ input: 4000 }), contextTokens: 4000 }),
      ],
      toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0, resultSeq: 1, resultChars: 3100 })],
    });
    const item = attributionByRef(attributeTranscript(t, pricing)).get('toolu_a');
    expect(item?.ingestRequestSeq).toBe(2);
    expect(item?.lastCarrySeq).toBe(6);
  });

  it('stops the carry range at a compaction boundary', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 2, usage: usage({ input: 2000 }), contextTokens: 2000 }),
        request({ seq: 4, usage: usage({ input: 3000 }), contextTokens: 3000 }),
        request({ seq: 8, usage: usage({ input: 900 }), contextTokens: 900 }),
      ],
      toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0, resultSeq: 1, resultChars: 3100 })],
      compactions: [compaction({ seq: 6 })],
    });
    const item = attributionByRef(attributeTranscript(t, pricing)).get('toolu_a');
    expect(item?.ingestRequestSeq).toBe(2);
    expect(item?.lastCarrySeq).toBe(4);
  });

  it('forces the heuristic and drops the carry when the compaction sits inside the gap', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 4, usage: usage({ input: 2000 }), contextTokens: 2000 }),
      ],
      toolCalls: [toolCall({ toolUseId: 'toolu_a', requestSeq: 0, resultSeq: 1, resultChars: 3100 })],
      compactions: [compaction({ seq: 2 })],
    });
    const item = attributionByRef(attributeTranscript(t, pricing)).get('toolu_a');
    expect(item?.estMethod).toBe('heuristic');
    expect(item?.tokens).toBeCloseTo(1000, 6);
    expect(item?.lastCarrySeq).toBeNull();
  });
});

describe('chars per token', () => {
  it('comes from the model of the ingesting request', () => {
    const modern = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 2, model: 'claude-opus-5', usage: usage({ input: 99_000 }), contextTokens: 99_000 }),
      ],
      injections: [injection({ seq: 1, chars: 1240 })],
    });
    const legacy = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 2, model: 'claude-sonnet-4-5', usage: usage({ input: 99_000 }), contextTokens: 99_000 }),
      ],
      injections: [injection({ seq: 1, chars: 1240 })],
    });
    expect(attributeTranscript(modern, pricing).items[0]?.tokens).toBeCloseTo(400, 6);
    expect(attributeTranscript(legacy, pricing).items[0]?.tokens).toBeCloseTo(310, 6);
  });

  it('falls back to 4.0 chars per token for unknown models', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 2, model: 'gpt-9', usage: usage({ input: 99_000 }), contextTokens: 99_000 }),
      ],
      injections: [injection({ seq: 1, chars: 400 })],
    });
    expect(attributeTranscript(t, pricing).items[0]?.tokens).toBeCloseTo(100, 6);
  });
});

describe('synthetic requests', () => {
  it('are excluded from the request sequence used for gaps', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000 }), contextTokens: 1000 }),
        request({ seq: 1, model: '<synthetic>', isSynthetic: true, usage: usage(), contextTokens: 0 }),
        request({ seq: 4, usage: usage({ input: 2000 }), contextTokens: 2000 }),
      ],
      injections: [injection({ seq: 2, chars: 310 })],
    });
    const attribution = attributeTranscript(t, pricing);
    expect(attribution.outputShares.has(1)).toBe(false);
    expect(attribution.items[0]?.ingestRequestSeq).toBe(4);
  });
});

describe('assistant history', () => {
  it('bills each reply as history ingested by the next request, minus its thinking', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, turnIndex: 0, usage: usage({ input: 1000, output: 500, thinking: 100 }), contextTokens: 1000 }),
        request({ seq: 1, turnIndex: 1, usage: usage({ input: 1400, output: 200 }), contextTokens: 1400 }),
        request({ seq: 2, turnIndex: 2, usage: usage({ input: 1600 }), contextTokens: 1600 }),
      ],
    });
    const items = attributeTranscript(t, pricing).items.filter((i) => i.kind === 'assistant_history');
    // Turn changes at every request here, so the thinking tokens are never re-sent.
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first?.tokens).toBe(400);
    expect(first?.estMethod).toBe('exact-output');
    expect(first?.ingestRequestSeq).toBe(1);
    expect(first?.lastCarrySeq).toBe(2);
    expect(items[1]?.tokens).toBe(200);
    expect(items[1]?.ingestRequestSeq).toBe(2);
    expect(items[1]?.lastCarrySeq).toBeNull();
  });

  it('carries thinking tokens only to the end of the turn that produced them', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, turnIndex: 0, usage: usage({ input: 1000, output: 500, thinking: 300 }), contextTokens: 1000 }),
        request({ seq: 1, turnIndex: 0, usage: usage({ input: 1500 }), contextTokens: 1500 }),
        request({ seq: 2, turnIndex: 1, usage: usage({ input: 1800 }), contextTokens: 1800 }),
      ],
    });
    const items = attributeTranscript(t, pricing).items.filter((i) => i.kind === 'assistant_history');
    const text = items.find((i) => i.tokens === 200);
    const thinking = items.find((i) => i.tokens === 300);
    expect(text?.lastCarrySeq).toBe(2);
    expect(thinking?.ingestRequestSeq).toBe(1);
    expect(thinking?.lastCarrySeq).toBe(1);
  });

  it('skips a reply that a compaction swallowed before the next request', () => {
    const t = transcript({
      requests: [
        request({ seq: 0, usage: usage({ input: 1000, output: 500 }), contextTokens: 1000 }),
        request({ seq: 2, usage: usage({ input: 400 }), contextTokens: 400 }),
      ],
      compactions: [compaction({ seq: 1 })],
    });
    const items = attributeTranscript(t, pricing).items.filter((i) => i.kind === 'assistant_history');
    expect(items).toEqual([]);
  });
});

describe('baseline context', () => {
  it('is the first request context minus the items that preceded it, carried to the end', () => {
    const t = transcript({
      requests: [
        request({ seq: 1, usage: usage({ input: 10_000, output: 100 }), contextTokens: 10_000 }),
        request({ seq: 3, usage: usage({ input: 10_500 }), contextTokens: 10_500 }),
      ],
      injections: [injection({ seq: 0, kind: 'user_prompt', chars: 310 })],
    });
    const items = attributeTranscript(t, pricing).items;
    const baseline = items.find((i) => i.kind === 'baseline');
    expect(baseline?.tokens).toBeCloseTo(10_000 - 100, 6);
    expect(baseline?.ingestRequestSeq).toBe(1);
    expect(baseline?.lastCarrySeq).toBe(3);
    expect(baseline?.estMethod).toBe('heuristic');
  });

  it('survives a compaction and gets a floor item for what the compaction left behind', () => {
    const t = transcript({
      requests: [
        request({ seq: 1, usage: usage({ input: 10_000, output: 100 }), contextTokens: 10_000 }),
        request({ seq: 4, usage: usage({ input: 12_000 }), contextTokens: 12_000 }),
        request({ seq: 5, usage: usage({ input: 12_400 }), contextTokens: 12_400 }),
      ],
      injections: [injection({ seq: 3, kind: 'compact_summary', chars: 3100 })],
      compactions: [compaction({ seq: 2 })],
    });
    const items = attributeTranscript(t, pricing).items;
    const baseline = items.find((i) => i.kind === 'baseline');
    const floor = items.find((i) => i.kind === 'post_compaction_floor');
    expect(baseline?.tokens).toBeCloseTo(10_000, 6);
    // The baseline is carried past the boundary, to the last request of the transcript.
    expect(baseline?.lastCarrySeq).toBe(5);
    // 12,000 − 1,000 (the summary) − 10,000 (the baseline, already carried) = 1,000.
    expect(floor?.tokens).toBeCloseTo(1000, 6);
    expect(floor?.ingestRequestSeq).toBe(4);
    expect(floor?.lastCarrySeq).toBe(5);
  });

  it('skips a leading background call whose context cannot hold the items charged to it', () => {
    // A resumed session: seq 1 is a tiny background call, the conversation restarts at seq 3 with
    // the compact summary already in its context.
    const t = transcript({
      requests: [
        request({ seq: 1, usage: usage({ input: 700 }), contextTokens: 700 }),
        request({ seq: 3, usage: usage({ input: 40_000 }), contextTokens: 40_000 }),
        request({ seq: 4, usage: usage({ input: 41_000 }), contextTokens: 41_000 }),
      ],
      injections: [injection({ seq: 0, kind: 'compact_summary', chars: 31_000 })],
    });
    const baseline = attributeTranscript(t, pricing).items.find((i) => i.kind === 'baseline');
    expect(baseline?.ingestRequestSeq).toBe(3);
    // 40,000 − the 10,000-token summary that is still being carried.
    expect(baseline?.tokens).toBeCloseTo(30_000, 6);
    expect(baseline?.lastCarrySeq).toBe(4);
  });

  it('never goes negative when the items before the first request over-estimate its context', () => {
    const t = transcript({
      requests: [request({ seq: 1, usage: usage({ input: 100 }), contextTokens: 100 })],
      injections: [injection({ seq: 0, kind: 'user_prompt', chars: 31_000 })],
    });
    expect(attributeTranscript(t, pricing).items.some((i) => i.kind === 'baseline')).toBe(false);
  });
});

describe('reconciliation', () => {
  it('accounts for every context token of every request', () => {
    const t = transcript({
      requests: [
        request({ seq: 1, turnIndex: 0, usage: usage({ input: 5000, output: 100 }), contextTokens: 5000 }),
        request({ seq: 3, turnIndex: 0, usage: usage({ cacheRead: 5000, cache5m: 1100, output: 200 }), contextTokens: 6100 }),
        request({ seq: 5, turnIndex: 0, usage: usage({ cacheRead: 6100, cache5m: 1200 }), contextTokens: 7300 }),
      ],
      injections: [
        injection({ seq: 0, kind: 'user_prompt', chars: 310 }),
        injection({ seq: 2, chars: 3100 }),
        injection({ seq: 4, chars: 3100 }),
      ],
    });
    const items = attributeTranscript(t, pricing).items;
    for (const req of t.requests) {
      const live = items
        .filter(
          (i) =>
            i.ingestRequestSeq !== null &&
            i.ingestRequestSeq <= req.seq &&
            (i.ingestRequestSeq === req.seq || (i.lastCarrySeq ?? -1) >= req.seq),
        )
        .reduce((sum, i) => sum + i.tokens, 0);
      expect(live).toBeCloseTo(req.contextTokens, 6);
    }
  });
});

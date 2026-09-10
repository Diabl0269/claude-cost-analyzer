import { describe, expect, it } from 'vitest';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import {
  STANDARD_FLAGS,
  createPriceResolver,
  findModelPrice,
  modelFamily,
  normalizeModelId,
  parseWhatIf,
  resolvePrice,
} from '../../../core/pricing/resolve.js';
import { costOfUsage, emptyUsage } from '../../../core/pricing/money.js';
import type { PricingConfig } from '../../../core/types.js';

const pricing = defaultPricing();

describe('normalizeModelId', () => {
  it('lowercases and strips the [1m] marker and @version suffix', () => {
    expect(normalizeModelId('Claude-Opus-5[1m]')).toBe('claude-opus-5');
    expect(normalizeModelId('claude-opus-5@20260101')).toBe('claude-opus-5');
    expect(normalizeModelId('  claude-sonnet-5[1m]  ')).toBe('claude-sonnet-5');
    expect(normalizeModelId('<synthetic>')).toBe('<synthetic>');
  });
});

describe('findModelPrice', () => {
  it('picks the longest matching prefix', () => {
    expect(findModelPrice('claude-fable-5-1', pricing)?.key).toBe('fable-5.1');
    expect(findModelPrice('claude-fable-5', pricing)?.key).toBe('fable-5');
    expect(findModelPrice('claude-fable-5-1-20260101', pricing)?.key).toBe('fable-5.1');
    expect(findModelPrice('claude-haiku-4-5-20251001', pricing)?.key).toBe('haiku-4.5');
  });

  it('matches the [1m] variant used by cost-state lines', () => {
    expect(findModelPrice('claude-opus-5[1m]', pricing)?.key).toBe('opus-5');
  });

  it('only uses exact entries when no prefix entry matched', () => {
    expect(findModelPrice('claude-opus-4', pricing)?.key).toBe('opus-4');
    expect(findModelPrice('claude-opus-4-2', pricing)?.key).toBe('opus-4');
    expect(findModelPrice('claude-opus-4-1-20250805', pricing)?.key).toBe('opus-4.1');
    expect(findModelPrice('claude-sonnet-4', pricing)?.key).toBe('sonnet-4');
    expect(findModelPrice('claude-sonnet-4-5-20250929', pricing)?.key).toBe('sonnet-4.5');
  });

  it('returns null for models it has never heard of', () => {
    expect(findModelPrice('gpt-9', pricing)).toBeNull();
  });
});

describe('resolvePrice', () => {
  it('converts USD/MTok to USD/token', () => {
    const price = resolvePrice('claude-opus-5', STANDARD_FLAGS, pricing);
    expect(price.perToken.input).toBeCloseTo(5 / 1e6, 15);
    expect(price.perToken.output).toBeCloseTo(25 / 1e6, 15);
    expect(price.perToken.cacheWrite5m).toBeCloseTo(6.25 / 1e6, 15);
    expect(price.perToken.cacheWrite1h).toBeCloseTo(10 / 1e6, 15);
    expect(price.perToken.cacheRead).toBeCloseTo(0.5 / 1e6, 15);
    expect(price.charsPerToken).toBe(3.1);
    expect(price.unpriced).toBe(false);
  });

  it('uses fast prices only when the model defines them', () => {
    const fast = resolvePrice('claude-opus-5', { ...STANDARD_FLAGS, speed: 'fast' }, pricing);
    expect(fast.perToken.input).toBeCloseTo(10 / 1e6, 15);
    expect(fast.multipliers.fast).toBe(true);

    const noFast = resolvePrice('claude-sonnet-5', { ...STANDARD_FLAGS, speed: 'fast' }, pricing);
    expect(noFast.perToken.input).toBeCloseTo(2 / 1e6, 15);
    expect(noFast.multipliers.fast).toBe(false);
  });

  it('applies the us-geo multiplier only to models that support it', () => {
    const opus = resolvePrice('claude-opus-5', { ...STANDARD_FLAGS, inferenceGeo: 'us' }, pricing);
    expect(opus.perToken.input).toBeCloseTo((5 * 1.1) / 1e6, 15);
    expect(opus.multipliers.usGeo).toBe(true);

    const haiku = resolvePrice('claude-haiku-4-5', { ...STANDARD_FLAGS, inferenceGeo: 'us' }, pricing);
    expect(haiku.perToken.input).toBeCloseTo(1 / 1e6, 15);
    expect(haiku.multipliers.usGeo).toBe(false);
  });

  it('halves token prices for batch requests', () => {
    const batch = resolvePrice('claude-opus-5', { ...STANDARD_FLAGS, serviceTier: 'batch' }, pricing);
    expect(batch.perToken.output).toBeCloseTo(12.5 / 1e6, 15);
    expect(batch.multipliers.batch).toBe(true);
  });

  it('stacks fast, us-geo and batch multipliers', () => {
    const price = resolvePrice(
      'claude-opus-5',
      { speed: 'fast', inferenceGeo: 'us', serviceTier: 'batch' },
      pricing,
    );
    expect(price.perToken.input).toBeCloseTo((10 * 1.1 * 0.5) / 1e6, 15);
  });

  it('zeroes unknown models under the default policy and flags them', () => {
    const price = resolvePrice('gpt-9', STANDARD_FLAGS, pricing);
    expect(price.unpriced).toBe(true);
    expect(price.modelKey).toBeNull();
    expect(price.perToken.output).toBe(0);
    expect(price.charsPerToken).toBe(4);
  });

  it('falls back to a named model when the policy asks for it', () => {
    const config: PricingConfig = {
      ...pricing,
      unknownModelPolicy: 'fallbackModel',
      fallbackModelKey: 'sonnet-5',
    };
    const price = resolvePrice('gpt-9', STANDARD_FLAGS, config);
    expect(price.modelKey).toBe('sonnet-5');
    expect(price.unpriced).toBe(true);
    expect(price.perToken.output).toBeCloseTo(10 / 1e6, 15);
  });

  it('prices synthetic messages at zero', () => {
    const price = resolvePrice('<synthetic>', STANDARD_FLAGS, pricing);
    expect(price.unpriced).toBe(false);
    expect(price.perToken.input + price.perToken.output).toBe(0);
    expect(price.family).toBe('synthetic');
  });
});

describe('pricing table anchors', () => {
  it('matches the real cost-state Haiku 4.5 line: 6735 in + 18 out = $0.006825', () => {
    const price = resolvePrice('claude-haiku-4-5-20251001', STANDARD_FLAGS, pricing);
    const usage = { ...emptyUsage(), input: 6735, output: 18 };
    expect(costOfUsage(usage, price, pricing.webSearchPer1000).total).toBeCloseTo(0.006825, 10);
  });

  it('bills web search per 1000 requests', () => {
    const price = resolvePrice('claude-opus-5', STANDARD_FLAGS, pricing);
    const usage = { ...emptyUsage(), webSearchRequests: 3 };
    expect(costOfUsage(usage, price, pricing.webSearchPer1000).webSearch).toBeCloseTo(0.03, 12);
  });
});

describe('modelFamily', () => {
  it('classifies every shipped family', () => {
    expect(modelFamily('claude-opus-5')).toBe('opus');
    expect(modelFamily('claude-sonnet-4-6')).toBe('sonnet');
    expect(modelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(modelFamily('claude-fable-5-1')).toBe('fable');
    expect(modelFamily('claude-mythos-5')).toBe('mythos');
    expect(modelFamily('<synthetic>')).toBe('synthetic');
    expect(modelFamily('gpt-9')).toBe('other');
  });
});

describe('createPriceResolver', () => {
  it('substitutes prices for what-if swaps without touching unknown models', () => {
    const resolve = createPriceResolver(pricing, parseWhatIf('opus-5>sonnet-5'));
    expect(resolve('claude-opus-5', STANDARD_FLAGS).perToken.output).toBeCloseTo(10 / 1e6, 15);
    expect(resolve('claude-haiku-4-5', STANDARD_FLAGS).perToken.output).toBeCloseTo(5 / 1e6, 15);
    expect(resolve('gpt-9', STANDARD_FLAGS).unpriced).toBe(true);
  });

  it('parses the wire format for what-if swaps', () => {
    expect([...parseWhatIf('a>b,c>d').entries()]).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseWhatIf(undefined).size).toBe(0);
    expect(parseWhatIf('garbage').size).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  EM_DASH,
  formatCount,
  formatDate,
  formatDuration,
  formatMoney,
  formatMoneyDelta,
  formatModelLabel,
  formatMoneyExact,
  formatPercent,
  formatTokens,
  formatTokensExact,
  fromIsoDay,
  truncateMiddle,
  relativeTime,
  toIsoDay,
  truncate,
} from '../../web/src/lib/format.js';

describe('formatMoney', () => {
  it('uses two decimals at or above a cent', () => {
    expect(formatMoney(143.5062)).toBe('$143.51');
    expect(formatMoney(0.01)).toBe('$0.01');
    expect(formatMoney(1284.06)).toBe('$1,284.06');
  });

  it('uses four decimals under a cent', () => {
    expect(formatMoney(0.0042)).toBe('$0.0042');
    expect(formatMoney(0.006825)).toBe('$0.0068');
  });

  it('floors at $0.0001', () => {
    expect(formatMoney(0.00002)).toBe('<$0.0001');
    expect(formatMoney(-0.00002)).toBe('-<$0.0001');
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('keeps the sign for negatives and deltas', () => {
    expect(formatMoney(-12.5)).toBe('-$12.50');
    expect(formatMoneyDelta(12.5)).toBe('+$12.50');
    expect(formatMoneyDelta(-0.004)).toBe('-$0.0040');
    expect(formatMoneyDelta(0)).toBe('$0.00');
  });

  it('renders full precision for titles', () => {
    expect(formatMoneyExact(0.006825)).toBe('$0.006825');
    expect(formatMoneyExact(143.5062)).toBe('$143.506200');
  });

  it('applies a display currency', () => {
    expect(formatMoney(10, { code: 'EUR', rate: 0.9 })).toBe('€9.00');
  });

  it('returns an em dash for missing values', () => {
    expect(formatMoney(null)).toBe(EM_DASH);
    expect(formatMoney(Number.NaN)).toBe(EM_DASH);
  });
});

describe('formatTokens', () => {
  it('is exact under a thousand and compact above', () => {
    expect(formatTokens(843)).toBe('843');
    expect(formatTokens(1240)).toBe('1,240');
    expect(formatTokens(12_482)).toBe('12.5k');
    expect(formatTokens(94_820_000)).toBe('94.8M');
    expect(formatTokens(8_942_006)).toBe('8.9M');
    expect(formatTokens(1_240_000)).toBe('1.2M');
  });

  it('groups the exact form', () => {
    expect(formatTokensExact(8_942_006)).toBe('8,942,006');
    expect(formatCount(1187)).toBe('1,187');
  });
});

describe('formatPercent', () => {
  it('scales fractions and keeps one decimal below ten percent', () => {
    expect(formatPercent(0.942)).toBe('94%');
    expect(formatPercent(0.042)).toBe('4.2%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.0002)).toBe('<0.1%');
  });
});

describe('formatDuration', () => {
  it('picks a unit per magnitude', () => {
    expect(formatDuration(620)).toBe('620ms');
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(750_000)).toBe('12m 30s');
    expect(formatDuration(11_040_000)).toBe('3h 04m');
    expect(formatDuration(190_000_000)).toBe('2d 4h');
  });

  it('carries instead of printing a 60 in a minute or second slot', () => {
    expect(formatDuration(239_600)).toBe('4m 00s');
    expect(formatDuration(59_600)).toBe('1m 00s');
    expect(formatDuration(3_599_600)).toBe('1h 00m');
    expect(formatDuration(86_399_600)).toBe('1d 0h');
    // 9.96s rounds to 10.0s at one decimal, so it belongs to the whole-seconds branch.
    expect(formatDuration(9_960)).toBe('10s');
  });

  it('is symmetric around zero and tolerates missing values', () => {
    expect(formatDuration(-239_600)).toBe('4m 00s');
    expect(formatDuration(null)).toBe(EM_DASH);
    expect(formatDuration(Number.NaN)).toBe(EM_DASH);
  });
});

describe('dates', () => {
  it('round-trips local ISO days', () => {
    const day = fromIsoDay('2026-09-07');
    expect(day?.getFullYear()).toBe(2026);
    expect(day?.getMonth()).toBe(8);
    expect(day?.getDate()).toBe(7);
    expect(toIsoDay(day as Date)).toBe('2026-09-07');
    expect(fromIsoDay('nope')).toBeNull();
  });

  it('formats dates without a timezone shift', () => {
    expect(formatDate(fromIsoDay('2026-09-07'), 'date')).toBe('Sep 7, 2026');
  });

  it('describes relative time', () => {
    const now = new Date('2026-09-07T12:00:00Z');
    expect(relativeTime(new Date('2026-09-07T11:58:00Z'), now)).toBe('2m ago');
    expect(relativeTime(new Date('2026-09-07T08:00:00Z'), now)).toBe('4h ago');
    expect(relativeTime(new Date('2026-09-06T10:00:00Z'), now)).toBe('yesterday');
    expect(relativeTime(new Date('2026-09-03T12:00:00Z'), now)).toBe('4d ago');
    expect(relativeTime(new Date('2026-09-07T11:59:50Z'), now)).toBe('just now');
    expect(relativeTime(null, now)).toBe(EM_DASH);
  });
});

describe('text helpers', () => {
  it('truncates on a word boundary', () => {
    expect(truncate('Refactor billing webhooks', 40)).toBe('Refactor billing webhooks');
    expect(truncate('Refactor the billing webhooks module', 20)).toBe('Refactor the billing…');
  });

  it('labels model ids with the shared core rules', () => {
    expect(formatModelLabel('claude-opus-5')).toBe('Opus 5');
    expect(formatModelLabel('claude-opus-5[1m]')).toBe('Opus 5 (1M)');
    expect(formatModelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(formatModelLabel('claude-fable-5-1')).toBe('Fable 5.1');
  });
});

describe('truncateMiddle', () => {
  it('keeps both ends of a path', () => {
    expect(truncateMiddle('/srv/work/lumen-web/src/index.ts', 16)).toBe('/srv/wor…ndex.ts');
    expect(truncateMiddle('/Users/dev', 40)).toBe('/Users/dev');
  });

  it('never returns more characters than it was given room for', () => {
    for (const max of [2, 3, 8, 17]) {
      expect(truncateMiddle('/a/very/long/absolute/path/somewhere', max).length).toBeLessThanOrEqual(max);
    }
  });
});

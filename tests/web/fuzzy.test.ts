import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank, highlightRuns } from '../../web/src/lib/fuzzy.js';

describe('fuzzyMatch', () => {
  it('matches subsequences and rejects missing characters', () => {
    expect(fuzzyMatch('Analytics · Tools', 'tools')).not.toBeNull();
    expect(fuzzyMatch('Analytics · Tools', 'ats')).not.toBeNull();
    expect(fuzzyMatch('Analytics · Tools', 'zz')).toBeNull();
  });

  it('scores prefixes and word starts above scattered hits', () => {
    const prefix = fuzzyMatch('Sessions', 'ses');
    const scattered = fuzzyMatch('Subagent expenses', 'ses');
    expect(prefix?.score ?? 0).toBeGreaterThan(scattered?.score ?? 0);
  });

  it('reports the matched indices', () => {
    expect(fuzzyMatch('Overview', 'ovw')?.indices).toEqual([0, 1, 7]);
  });

  it('treats an empty needle as a match with no highlights', () => {
    expect(fuzzyMatch('anything', '')).toEqual({ score: 0, indices: [] });
  });
});

describe('fuzzyRank', () => {
  const items = ['Overview', 'Sessions', 'Settings', 'Analytics · Models'];

  it('keeps input order for an empty query', () => {
    expect(fuzzyRank(items, '  ', (item) => item).map((r) => r.item)).toEqual(items);
  });

  it('orders by score', () => {
    const ranked = fuzzyRank(items, 'set', (item) => item);
    expect(ranked[0]?.item).toBe('Settings');
    expect(ranked.map((r) => r.item)).not.toContain('Overview');
  });
});

describe('highlightRuns', () => {
  it('splits into matched and unmatched runs', () => {
    expect(highlightRuns('Sessions', [0, 1, 2])).toEqual([
      { text: 'Ses', match: true },
      { text: 'sions', match: false },
    ]);
  });

  it('returns one run when nothing matched', () => {
    expect(highlightRuns('Sessions', [])).toEqual([{ text: 'Sessions', match: false }]);
  });
});

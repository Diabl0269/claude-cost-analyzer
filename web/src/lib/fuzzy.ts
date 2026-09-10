/** Subsequence matcher used by the command palette. No dependencies, no regex building. */

export interface FuzzyMatch {
  score: number;
  /** indices in the haystack that matched, for highlighting */
  indices: number[];
}

/**
 * Scores a subsequence match. Consecutive characters, word starts and prefix hits
 * score higher; a missing character means no match at all.
 */
export function fuzzyMatch(haystack: string, needle: string): FuzzyMatch | null {
  if (!needle) return { score: 0, indices: [] };
  const text = haystack.toLowerCase();
  const query = needle.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let cursor = 0;
  let previous = -2;

  for (const char of query) {
    if (char === ' ') continue;
    const at = text.indexOf(char, cursor);
    if (at === -1) return null;
    let points = 1;
    if (at === previous + 1) points += 4;
    if (at === 0) points += 6;
    else {
      const before = text[at - 1];
      if (before === ' ' || before === '/' || before === '-' || before === '_' || before === '·') points += 3;
    }
    score += points;
    indices.push(at);
    previous = at;
    cursor = at + 1;
  }
  // Shorter haystacks win ties: a 12-char command beats a 60-char one.
  score += Math.max(0, 12 - Math.min(haystack.length, 12));
  return { score, indices };
}

export interface RankedItem<T> {
  item: T;
  score: number;
  indices: number[];
}

/** Filters and orders items by their best match on `text`. Empty query keeps input order. */
export function fuzzyRank<T>(items: readonly T[], query: string, text: (item: T) => string): RankedItem<T>[] {
  const trimmed = query.trim();
  if (!trimmed) return items.map((item) => ({ item, score: 0, indices: [] }));
  const ranked: RankedItem<T>[] = [];
  items.forEach((item, index) => {
    const match = fuzzyMatch(text(item), trimmed);
    if (match) ranked.push({ item, score: match.score - index * 0.001, indices: match.indices });
  });
  return ranked.sort((a, b) => b.score - a.score);
}

/** Splits a string into matched / unmatched runs for highlighted rendering. */
export function highlightRuns(text: string, indices: readonly number[]): { text: string; match: boolean }[] {
  if (indices.length === 0) return [{ text, match: false }];
  const marks = new Set(indices);
  const runs: { text: string; match: boolean }[] = [];
  let current = '';
  let currentMatch = marks.has(0);
  for (let i = 0; i < text.length; i += 1) {
    const isMatch = marks.has(i);
    if (isMatch !== currentMatch && current) {
      runs.push({ text: current, match: currentMatch });
      current = '';
    }
    currentMatch = isMatch;
    current += text[i] ?? '';
  }
  if (current) runs.push({ text: current, match: currentMatch });
  return runs;
}

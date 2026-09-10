/**
 * Idle gaps between requests, and what the silence cost.
 *
 * Prompt caching keeps a context alive for five minutes (an hour for the 1-hour tier). After a
 * longer pause the entries are gone and the next request pays the full cache-write price to put
 * the same context back. The Timeline draws these; the Summary's one-line verdict names them.
 */
import type { RequestCost } from '@core/types';

/** Cache entries written with a 5-minute TTL are gone after this much silence. */
export const CACHE_5M_MS = 5 * 60_000;
export const CACHE_1H_MS = 60 * 60_000;

export interface IdleGap {
  id: string;
  fromMs: number;
  toMs: number;
  ms: number;
  /** the first request after the gap: what re-warming the cache actually cost */
  rewarmCost: number;
  rewarmTokens: number;
  expired: '5m' | '1h';
}

export function idleGaps(requests: RequestCost[]): IdleGap[] {
  const gaps: IdleGap[] = [];
  for (let i = 1; i < requests.length; i += 1) {
    const previous = requests[i - 1];
    const current = requests[i];
    if (!previous || !current) continue;
    const fromMs = new Date(previous.ts).getTime();
    const toMs = new Date(current.ts).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;
    const ms = toMs - fromMs;
    if (ms < CACHE_5M_MS) continue;
    gaps.push({
      id: `${previous.seq}-${current.seq}`,
      fromMs,
      toMs,
      ms,
      rewarmCost: current.cost.cacheWrite,
      rewarmTokens: current.usage.cache5m + current.usage.cache1h,
      expired: ms >= CACHE_1H_MS ? '1h' : '5m',
    });
  }
  return gaps;
}

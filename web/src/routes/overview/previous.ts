import { fromIsoDay, toIsoDay } from '@/lib/format';

const DAY_MS = 86_400_000;

/**
 * The equal-length window immediately before `[from, to]`, so KPIs can carry a delta.
 * Both bounds are inclusive local days, which is what the API expects.
 */
export function previousWindow(from: string, to: string): { from: string; to: string } | null {
  const start = fromIsoDay(from);
  const end = fromIsoDay(to);
  if (!start || !end || end.getTime() < start.getTime()) return null;
  // Rounding absorbs the ±1h a DST boundary puts into the millisecond difference.
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - (days - 1));
  return { from: toIsoDay(previousStart), to: toIsoDay(previousEnd) };
}

/**
 * Signed fractional change against the previous window, or `null` when the comparison would be
 * meaningless (no previous activity, so every metric would read "+∞").
 */
export function deltaFraction(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return (current - previous) / previous;
}

/**
 * How small the previous window may get before its percentage stops meaning anything. A window
 * holding under a tenth of the current value turns every KPI into a four-digit rise ("▲ 1,428%")
 * that says "we had almost no data last month", not "spend exploded".
 */
export const PRIOR_NOISE_FLOOR = 0.1;

/** True when the previous window is too empty for a percentage delta to be worth showing. */
export function priorTooSmall(current: number, previous: number): boolean {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return true;
  return previous < Math.abs(current) * PRIOR_NOISE_FLOOR;
}

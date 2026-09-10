/**
 * Axis arithmetic for the session timeline, kept free of imports so
 * `tests/web/timeline-axis.test.ts` can load it under NodeNext without the web aliases.
 */

/** Under an hour the axis counts elapsed time from the start instead of printing a clock. */
export const SHORT_SPAN_MS = 60 * 60_000;

/** Below this the ticks are whole seconds; above it, minutes and seconds. */
const SECONDS_ONLY_MS = 120_000;

/**
 * A tick label for `ms` after the start of a session whose whole span is `spanMs`:
 * `0s · 20s · 40s` for a minute-long session, `0s · 1m 15s · 2m 30s` for a longer one.
 *
 * Rounds to whole seconds *before* splitting into minutes, so a remainder cannot carry into an
 * impossible digit — 299,600 ms is `5m`, never `4m 60s`.
 */
export function elapsedTick(ms: number, spanMs: number): string {
  const totalSeconds = Math.round(Math.max(0, ms) / 1000);
  if (spanMs < SECONDS_ONLY_MS) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Even fractions of the span to label: five ticks for an elapsed axis, two for a clock. */
export function axisFractions(shortSpan: boolean): number[] {
  return shortSpan ? [0, 0.25, 0.5, 0.75, 1] : [0, 1];
}

/**
 * Compares a session's own token counts against Claude Code's `cost-state` tally (SPEC §5.4).
 *
 * The two numbers answer different questions, so a mismatch is usually structural rather than
 * arithmetic. The transcript file is the record of everything that was ever written for a session
 * id; the tally is an in-memory counter belonging to one Claude Code *process*. Forking,
 * continuing or resuming a session moves the boundary between them in one direction or the other,
 * and a handful of background calls (title generation) are billed without ever being logged.
 * Classifying the gap is therefore more useful than declaring a pass/fail delta.
 *
 * Every delta here is signed and expressed as a percentage of the larger of the two values, so it
 * is bounded by ±100 and stays defined when one side is zero. Positive means *we* counted more.
 */
import type { ReportedComparison, ReportedComparisonStatus, ReportedCost, TokenTotals } from '../types.js';

/** The four billed token classes, in the order they are reported and displayed. */
export interface TokenClassTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Deltas at or below this are treated as agreement. */
export const MATCH_TOLERANCE_PCT = 5;
/** Deltas beyond this in the same direction, in at least two classes, classify the session. */
export const DIVERGENCE_PCT = 10;
/**
 * A class is only used for classification when one side reaches this many tokens. Below it a
 * percentage says nothing: a real session's plain `input` is a few dozen tokens (everything else
 * is cache), so one 1,600-token background call — a title generation Claude Code bills but never
 * writes to the transcript — reads as a −99% "divergence" worth a fifth of a cent. 10,000 tokens
 * is under $0.10 even at Opus cache-write prices. The percentage is still reported; it is just
 * not allowed to decide the status.
 */
export const MIN_SIGNIFICANT_TOKENS = 10_000;
/** Above this USD a "hidden calls only" tally is too big to be background chatter. */
const HIDDEN_CALLS_MAX_USD = 1;
const MIN_DIVERGENT_CLASSES = 2;

export function emptyTokenClassTotals(): TokenClassTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/** Collapses our `TokenTotals` (which splits cache writes by TTL) into the reported four. */
export function computedTokenClasses(tokens: TokenTotals): TokenClassTotals {
  return {
    input: tokens.input,
    output: tokens.output,
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cache5m + tokens.cache1h,
  };
}

/**
 * Sums Claude Code's per-model tally. `thinkingTokens` is deliberately not added to `output`:
 * the API's `output_tokens` already includes thinking, and so does `cost-state`'s `outputTokens`.
 */
export function reportedTokenClasses(reported: ReportedCost): TokenClassTotals {
  const totals = emptyTokenClassTotals();
  for (const usage of Object.values(reported.modelUsage)) {
    totals.input += usage.inputTokens;
    totals.output += usage.outputTokens;
    totals.cacheRead += usage.cacheReadInputTokens;
    totals.cacheWrite += usage.cacheCreationInputTokens;
  }
  return totals;
}

/** Signed percentage delta of `computed` against `reported`, normalised by the larger side. */
export function deltaPct(computed: number, reported: number): number {
  const scale = Math.max(Math.abs(computed), Math.abs(reported));
  if (scale === 0) return 0;
  return ((computed - reported) / scale) * 100;
}

const CLASS_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

function total(classes: TokenClassTotals): number {
  return classes.input + classes.output + classes.cacheRead + classes.cacheWrite;
}

/**
 * Only background calls that Claude Code bills without logging look like this: nothing at all in
 * the file, and a tally with plain input and output but no cache traffic (a title generation runs
 * on a cold, tiny prompt) worth a fraction of a cent.
 */
function isHiddenCallsOnly(computed: TokenClassTotals, reported: ReportedCost, reportedClasses: TokenClassTotals): boolean {
  return (
    total(computed) === 0 &&
    total(reportedClasses) > 0 &&
    reportedClasses.cacheRead === 0 &&
    reportedClasses.cacheWrite === 0 &&
    reported.totalCostUSD <= HIDDEN_CALLS_MAX_USD
  );
}

function classify(
  classes: TokenClassTotals,
  computed: TokenClassTotals,
  reported: ReportedCost,
  reportedClasses: TokenClassTotals,
  usdDeltaPct: number,
): ReportedComparisonStatus {
  if (isHiddenCallsOnly(computed, reported, reportedClasses)) return 'hidden-calls-only';

  const significant = CLASS_KEYS.filter(
    (key) => Math.max(computed[key], reportedClasses[key]) >= MIN_SIGNIFICANT_TOKENS,
  ).map((key) => classes[key]);

  // Sessions too small for any class to clear the floor are judged on money alone.
  const deltas = significant.length > 0 ? significant : [usdDeltaPct];
  if (deltas.every((d) => Math.abs(d) <= MATCH_TOLERANCE_PCT)) return 'match';

  const above = deltas.filter((d) => d > DIVERGENCE_PCT).length;
  const below = deltas.filter((d) => d < -DIVERGENCE_PCT).length;
  if (above >= MIN_DIVERGENT_CLASSES && below === 0) return 'file-covers-more-than-tally';
  if (below >= MIN_DIVERGENT_CLASSES && above === 0) return 'tally-includes-earlier-process';
  if (above > 0 && below > 0) return 'mixed';
  // One class, or a set that all leans the same way without clearing the divergence bar: the
  // direction is still unambiguous, so name it rather than calling it mixed.
  if (deltas.every((d) => d >= 0)) return 'file-covers-more-than-tally';
  if (deltas.every((d) => d <= 0)) return 'tally-includes-earlier-process';
  return 'mixed';
}

/**
 * Builds the comparison for one session. `computedUsd` is our total for the whole session
 * (main transcript plus every agent), `reported` its last `cost-state` line.
 */
export function compareReported(
  computed: TokenClassTotals,
  computedUsd: number,
  reported: ReportedCost,
): ReportedComparison {
  const reportedClasses = reportedTokenClasses(reported);
  const classes: TokenClassTotals = {
    input: deltaPct(computed.input, reportedClasses.input),
    output: deltaPct(computed.output, reportedClasses.output),
    cacheRead: deltaPct(computed.cacheRead, reportedClasses.cacheRead),
    cacheWrite: deltaPct(computed.cacheWrite, reportedClasses.cacheWrite),
  };
  const usdDeltaPct = deltaPct(computedUsd, reported.totalCostUSD);
  return {
    status: classify(classes, computed, reported, reportedClasses, usdDeltaPct),
    deltaPct: usdDeltaPct,
    classes,
  };
}

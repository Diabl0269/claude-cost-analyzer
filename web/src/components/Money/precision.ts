/**
 * Decimal-point alignment for money columns.
 *
 * `formatMoney` is adaptive: two decimals normally, four under a cent. That is right for one
 * figure and wrong for a column of them — `$0.06`, `$0.0070` and `$0.27` in one right-aligned
 * column put three decimal points in three different places. So a column reserves room for the
 * widest fraction any of its own values needs, and every cell prints its fraction in that slot.
 * Nothing is rounded and no digit is invented: only the empty space to the right of the fraction
 * changes.
 *
 * Pure and DOM-free on purpose — `tests/web/money-precision.test.ts` imports it directly.
 */

/** Fraction digits `formatMoney` prints for one amount: 4 under a cent, 2 otherwise. */
export function naturalFractionDigits(usd: number): number {
  if (!Number.isFinite(usd)) return 0;
  const abs = Math.abs(usd);
  return abs > 0 && abs < 0.01 ? 4 : 2;
}

/**
 * The widest fraction in a column, or `null` when there is nothing to align (no values, or a
 * value that is not a finite number — a column of dashes needs no slot).
 */
export function columnFractionDigits(values: Iterable<number | null | undefined>): number | null {
  let digits: number | null = null;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    digits = Math.max(digits ?? 2, naturalFractionDigits(value));
  }
  return digits;
}

/** A CSS length that fits `digits` fraction digits plus the decimal point. */
export function fractionSlot(digits: number): string {
  return `${digits + 1}ch`;
}

export interface MoneyParts {
  /** everything up to and including the last digit before the decimal point */
  lead: string;
  /** the decimal point and the digits after it, or `''` when there is none */
  fraction: string;
}

/**
 * Splits a formatted amount on its decimal point so the fraction can live in its own box.
 * `'-$1,234.56'` → `{ lead: '-$1,234', fraction: '.56' }`; `'—'` → `{ lead: '—', fraction: '' }`.
 */
export function splitMoney(text: string): MoneyParts {
  const dot = text.lastIndexOf('.');
  if (dot < 0) return { lead: text, fraction: '' };
  return { lead: text.slice(0, dot), fraction: text.slice(dot) };
}

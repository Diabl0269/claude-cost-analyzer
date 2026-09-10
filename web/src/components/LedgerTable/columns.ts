/**
 * Column plumbing for `LedgerTable`, kept pure so `tests/web/ledger-columns.test.ts` can import
 * it without a DOM (hence relative imports with an explicit `.js`).
 */
import { columnFractionDigits, fractionSlot } from '../Money/precision.js';

/** What a column can be sorted by: a reader, or a dotted path into the row (`cost.total`). */
export type LedgerSortValue<Row> = ((row: Row) => number | string) | string;

/** `resolvePath(row, 'cost.total')`. Returns `undefined` for a path that is not there. */
export function resolvePath(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A dotted path becomes a reader; a reader is returned as it is. */
export function sortReader<Row>(sortValue: LedgerSortValue<Row>): (row: Row) => number | string {
  if (typeof sortValue === 'function') return sortValue;
  return (row) => {
    const value = resolvePath(row, sortValue);
    if (typeof value === 'number' || typeof value === 'string') return value;
    return value === null || value === undefined ? '' : String(value);
  };
}

/**
 * True when this dotted path resolves to a sortable primitive on a sample row — the test
 * `autoSort` runs before it turns a column id into a sort key, so a mistyped id leaves the
 * header a plain label instead of silently sorting by `undefined`.
 */
export function pathIsSortable(row: unknown, path: string): boolean {
  const value = resolvePath(row, path);
  return typeof value === 'number' || typeof value === 'string';
}

export function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * The `--money-frac` slot for a column of amounts, or `null` when the column holds anything
 * that is not a finite number (a count column costs nothing to skip, and a column of dashes
 * has no decimal point to align).
 */
export function moneySlot(values: Iterable<number | null | undefined>): string | null {
  const digits = columnFractionDigits(values);
  return digits === null ? null : fractionSlot(digits);
}

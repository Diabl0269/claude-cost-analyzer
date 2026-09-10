import { describe, expect, it } from 'vitest';
import {
  compareValues,
  moneySlot,
  pathIsSortable,
  resolvePath,
  sortReader,
} from '../../web/src/components/LedgerTable/columns.js';

interface Row {
  label: string;
  cost: { total: number; cacheRead: number | null };
  requests: number;
}

const rows: Row[] = [
  { label: 'Sonnet 5', cost: { total: 0.06, cacheRead: 0.0 }, requests: 3 },
  { label: 'Opus 5', cost: { total: 0.007, cacheRead: null }, requests: 12 },
  { label: 'Haiku 4.5', cost: { total: 0.27, cacheRead: 1.5 }, requests: 1 },
];

describe('ledger column plumbing', () => {
  it('reads a dotted path, and nothing where there is nothing', () => {
    expect(resolvePath(rows[0], 'cost.total')).toBe(0.06);
    expect(resolvePath(rows[0], 'label')).toBe('Sonnet 5');
    expect(resolvePath(rows[0], 'cost.missing')).toBeUndefined();
    expect(resolvePath(rows[0], 'label.deeper')).toBeUndefined();
    expect(resolvePath(null, 'cost')).toBeUndefined();
  });

  it('turns a path into the same reader as a function would be', () => {
    expect(rows.map(sortReader<Row>('cost.total'))).toEqual([0.06, 0.007, 0.27]);
    expect(rows.map(sortReader<Row>((row) => row.cost.total))).toEqual([0.06, 0.007, 0.27]);
    // A path that resolves to nothing sorts as an empty string rather than throwing.
    expect(rows.map(sortReader<Row>('cost.cacheRead'))).toEqual([0, '', 1.5]);
  });

  it('only marks a column sortable when its id really is a field', () => {
    expect(pathIsSortable(rows[0], 'requests')).toBe(true);
    expect(pathIsSortable(rows[0], 'cost.total')).toBe(true);
    expect(pathIsSortable(rows[0], 'cost')).toBe(false);
    expect(pathIsSortable(rows[0], 'nope')).toBe(false);
  });

  it('compares numbers as numbers and text naturally', () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues('item 2', 'item 10')).toBeLessThan(0);
    expect(compareValues('Opus', 'opus')).toBe(0);
  });

  it('reserves the widest fraction in the column, and skips a column of counts it cannot align', () => {
    expect(moneySlot(rows.map((row) => row.cost.total))).toBe('5ch');
    expect(moneySlot(rows.map((row) => row.requests))).toBe('3ch');
    expect(moneySlot(rows.map((row) => row.cost.cacheRead))).toBeNull();
  });
});

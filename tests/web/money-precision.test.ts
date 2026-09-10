import { describe, expect, it } from 'vitest';
import {
  columnFractionDigits,
  fractionSlot,
  naturalFractionDigits,
  splitMoney,
} from '../../web/src/components/Money/precision.js';
import { formatMoney } from '../../core/pricing/format.js';

describe('money decimal alignment', () => {
  it('knows how many decimals an amount prints', () => {
    expect(naturalFractionDigits(143.5062)).toBe(2);
    expect(naturalFractionDigits(0.06)).toBe(2);
    expect(naturalFractionDigits(0.007)).toBe(4);
    expect(naturalFractionDigits(0.000002)).toBe(4);
    expect(naturalFractionDigits(0)).toBe(2);
    expect(naturalFractionDigits(-0.0042)).toBe(4);
  });

  it('agrees with what formatMoney actually prints', () => {
    for (const value of [0, 0.00002, 0.007, 0.06, 0.27, 12.5, 1234.5678]) {
      const printed = formatMoney(value);
      const fraction = splitMoney(printed).fraction;
      expect(fraction.length - 1, printed).toBe(naturalFractionDigits(value));
    }
  });

  it('takes a column’s slot from its widest fraction', () => {
    // The audit's row: $0.06, $0.0070 and $0.27 in one column.
    expect(columnFractionDigits([0.06, 0.007, 0.27])).toBe(4);
    expect(columnFractionDigits([68.21, 48.17, 0.09])).toBe(2);
    expect(fractionSlot(4)).toBe('5ch');
    expect(fractionSlot(2)).toBe('3ch');
  });

  it('leaves a column alone when it holds anything that is not a number', () => {
    expect(columnFractionDigits([])).toBeNull();
    expect(columnFractionDigits([1.5, null])).toBeNull();
    expect(columnFractionDigits([Number.NaN])).toBeNull();
    expect(columnFractionDigits([1, undefined])).toBeNull();
  });

  it('splits a formatted amount on its decimal point', () => {
    expect(splitMoney('$1,234.56')).toEqual({ lead: '$1,234', fraction: '.56' });
    expect(splitMoney('-$0.0042')).toEqual({ lead: '-$0', fraction: '.0042' });
    expect(splitMoney('<$0.0001')).toEqual({ lead: '<$0', fraction: '.0001' });
    expect(splitMoney('—')).toEqual({ lead: '—', fraction: '' });
    expect(splitMoney('EUR 3.20')).toEqual({ lead: 'EUR 3', fraction: '.20' });
  });
});

import type { CSSProperties, HTMLAttributes } from 'react';
import { formatMoney, formatMoneyDelta, formatMoneyExact, type CurrencyDisplay } from '@/lib/format';
import { fractionSlot, splitMoney } from './precision';
import styles from './Money.module.css';

export interface MoneyProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  usd: number | null | undefined;
  /** render with an explicit + / − sign */
  delta?: boolean;
  /** `auto` colours deltas: cost red for more spend, save green for less */
  tone?: 'auto' | 'cost' | 'save' | 'none';
  currency?: CurrencyDisplay;
  /** larger, Fraunces numerals (KPIs, receipt totals) */
  display?: boolean;
  /** flips the meaning of the sign for savings figures */
  invert?: boolean;
  /**
   * Print exactly this many decimals instead of the adaptive rule (2 normally, 4 under a cent).
   * Use it when a whole column or receipt must carry one precision.
   */
  decimals?: number;
  /**
   * Reserve room for this many fraction digits without changing the digits printed, so the
   * decimal points of a column or a receipt sit on one vertical line. `LedgerTable` sets the
   * same thing for its numeric columns through the `--money-frac` custom property, so a table
   * cell needs no prop.
   */
  fractionDigits?: number;
}

/** Money, always tabular, always with full precision in the title (SPEC §8.1). */
export function Money({
  usd,
  delta = false,
  tone = 'none',
  currency,
  display = false,
  invert = false,
  decimals,
  fractionDigits,
  className,
  ...rest
}: MoneyProps) {
  const text = moneyText(usd, { delta, currency, decimals });
  const signed = usd ?? 0;
  const direction = invert ? -signed : signed;
  const toneClass =
    tone === 'none' || signed === 0
      ? null
      : tone === 'cost'
        ? styles.cost
        : tone === 'save'
          ? styles.save
          : direction > 0
            ? styles.cost
            : styles.save;

  const { lead, fraction } = splitMoney(text);
  // An explicit prop wins over the column-wide custom property; a fixed `decimals` needs no slot
  // at all, because every cell then prints the same number of digits.
  const slot: CSSProperties | undefined =
    fractionDigits !== undefined
      ? { minWidth: fractionSlot(fractionDigits) }
      : decimals !== undefined
        ? { minWidth: 0 }
        : undefined;

  return (
    <span
      className={[display ? 'num-display' : 'num', styles.money, toneClass, className].filter(Boolean).join(' ')}
      title={formatMoneyExact(usd, currency)}
      {...rest}
    >
      {fraction === '' ? (
        text
      ) : (
        <>
          {lead}
          <span className={styles.fraction} style={slot}>
            {fraction}
          </span>
        </>
      )}
    </span>
  );
}

interface TextOptions {
  delta: boolean;
  currency?: CurrencyDisplay;
  decimals?: number;
}

function moneyText(usd: number | null | undefined, { delta, currency, decimals }: TextOptions): string {
  if (decimals === undefined) return delta ? formatMoneyDelta(usd, currency) : formatMoney(usd, currency);
  return formatMoney(usd, currency, { decimals, signed: delta });
}

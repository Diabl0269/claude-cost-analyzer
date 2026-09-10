import type { ReactNode } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { Icon } from '@/components/Icon';
import { formatPercent } from '@/lib/format';
import styles from './Kpi.module.css';

export interface KpiDelta {
  /** signed fraction, e.g. -0.12 for “12% less than the previous period” */
  fraction: number;
  label?: string;
  /**
   * Which direction is the good one, for the red/green semantics. Only cost-like metrics have
   * one: `'none'` (the default) draws the arrow in ink, because a count going up is neither
   * good nor bad. Spend and cost per prompt are `'down'`, cache hit ratio is `'up'`.
   */
  good?: 'up' | 'down' | 'none';
}

export interface KpiProps {
  label: string;
  value: ReactNode;
  /** secondary line under the value */
  sub?: ReactNode;
  delta?: KpiDelta;
  /**
   * Sits where the delta would, in muted ink. Used when the previous window is too empty for a
   * percentage to mean anything, so the KPI states the prior figure instead of shouting a
   * four-digit rise.
   */
  note?: ReactNode;
  /** explains how the number is computed */
  hint?: string;
  size?: 'md' | 'lg';
}

/** One display numeral with its label — the unit the overview KPI row is built from. */
export function Kpi({ label, value, sub, delta, note, hint, size = 'md' }: KpiProps) {
  const positive = (delta?.fraction ?? 0) > 0;
  const goodDirection = delta?.good ?? 'none';
  const toneClass =
    goodDirection === 'none' ? styles.neutral : (positive ? goodDirection === 'up' : goodDirection === 'down') ? styles.good : styles.bad;

  return (
    <div className={[styles.kpi, size === 'lg' ? styles.lg : null].filter(Boolean).join(' ')}>
      <div className={styles.labelRow}>
        <span className="eyebrow">{label}</span>
        {hint ? (
          <Tooltip content={hint}>
            <button type="button" className={styles.hint} aria-label={`How ${label} is calculated`}>
              <Icon name="info" size={13} />
            </button>
          </Tooltip>
        ) : null}
      </div>
      <div className={styles.value}>{value}</div>
      {/* Always rendered, even when empty: it is the third row of the grid, and the row is what
          keeps the footer lines of six KPIs on one horizontal. */}
      <div className={styles.footer}>
        {delta ? (
          <span className={[styles.delta, toneClass].join(' ')}>
            <Icon name="chevron" size={12} rotate={positive ? -90 : 90} />
            <span className="num">{formatPercent(Math.abs(delta.fraction))}</span>
            {delta.label ? <span className={styles.deltaLabel}>{delta.label}</span> : null}
          </span>
        ) : null}
        {note ? <span className={styles.note}>{note}</span> : null}
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </div>
    </div>
  );
}

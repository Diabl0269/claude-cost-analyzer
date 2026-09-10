/**
 * In-row micro-bars for the ledger tables: a single share bar and a stacked split bar.
 *
 * Both are `aria-hidden`: they always sit beside the same numbers in their own table cells,
 * so exposing them again would only duplicate the row for screen-reader users. Real charts
 * (their own figure, their own data) go through `ChartFrame` instead.
 */
import styles from './bars.module.css';

export type BarPattern = 'solid' | 'hatch' | 'dots' | 'grid';

export interface BarSegment {
  id: string;
  label: string;
  value: number;
  /** a CSS colour, normally a `var(--…)` token */
  color: string;
  pattern?: BarPattern;
}

export interface SplitBarProps {
  segments: BarSegment[];
  /** denominator; defaults to the sum of the segments */
  total?: number;
  height?: number;
}

/** Stacked proportional bar (for example a tool's generate / ingest / carry split). */
export function SplitBar({ segments, total, height = 8 }: SplitBarProps) {
  const sum = total ?? segments.reduce((acc, segment) => acc + Math.max(0, segment.value), 0);
  return (
    <span className={styles.bar} style={{ ['--bar-h' as string]: `${height}px` }} aria-hidden="true">
      {sum > 0
        ? segments.map((segment) => {
            const share = Math.max(0, segment.value) / sum;
            if (share <= 0) return null;
            return (
              <span
                key={segment.id}
                className={`${styles.segment} ${styles[segment.pattern ?? 'solid']}`}
                style={{ width: `${share * 100}%`, ['--seg' as string]: segment.color }}
              />
            );
          })
        : null}
    </span>
  );
}

export interface ShareBarProps {
  fraction: number;
  color?: string;
  height?: number;
}

/** One filled bar showing a row's share of its table's total. */
export function ShareBar({ fraction, color = 'var(--ink-2)', height = 8 }: ShareBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <span className={styles.bar} style={{ ['--bar-h' as string]: `${height}px` }} aria-hidden="true">
      <span className={`${styles.segment} ${styles.solid}`} style={{ width: `${clamped * 100}%`, ['--seg' as string]: color }} />
    </span>
  );
}

/** Text legend for a `SplitBar`, so the colours are named somewhere on the page. */
export function BarLegend({ segments }: { segments: Pick<BarSegment, 'id' | 'label' | 'color' | 'pattern'>[] }) {
  return (
    <p className={styles.legend}>
      {segments.map((segment) => (
        <span key={segment.id} className={styles.legendItem}>
          <span
            className={`${styles.swatch} ${styles[segment.pattern ?? 'solid']}`}
            style={{ ['--seg' as string]: segment.color }}
            aria-hidden="true"
          />
          {segment.label}
        </span>
      ))}
    </p>
  );
}

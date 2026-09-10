import { useId } from 'react';
import { formatPercent, formatTokens, formatTokensExact } from '@/lib/format';
import { TOKEN_CLASS_COLOR, TOKEN_CLASS_LABEL, TOKEN_CLASS_ORDER, TOKEN_CLASS_PATTERN, type TokenClassKey } from '@/lib/chart';
import styles from './TokenBar.module.css';

export interface TokenBarTotals {
  input: number;
  output: number;
  cache5m: number;
  cache1h: number;
  cacheRead: number;
}

export interface TokenBarProps {
  tokens: TokenBarTotals;
  height?: number;
  showLegend?: boolean;
  /** overrides the generated summary */
  ariaLabel?: string;
  /** label rendered left of the bar */
  label?: string;
  /**
   * 0–1: how much of the track this bar fills, so a row of bars compares against each other
   * (a model at 80% of spend draws a bar 80% as long). Omitted means the full track.
   */
  fraction?: number;
}

/** Below this the bar would be a sub-pixel sliver, so the smallest rows keep a visible stub. */
const MIN_FRACTION_PERCENT = 0.8;

/** SVG defs shared by every stacked chart: hatch, dots and grid fills. */
export function ChartPatterns({ idPrefix }: { idPrefix: string }) {
  return (
    <defs>
      <pattern id={`${idPrefix}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" className={styles.patternStroke} strokeWidth="2" />
      </pattern>
      <pattern id={`${idPrefix}-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
        <circle cx="1.4" cy="1.4" r="1" className={styles.patternFill} />
      </pattern>
      <pattern id={`${idPrefix}-grid`} width="5" height="5" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="5" y2="0" className={styles.patternStroke} strokeWidth="1" />
      </pattern>
    </defs>
  );
}

export function patternFor(idPrefix: string, key: TokenClassKey): string | undefined {
  const pattern = TOKEN_CLASS_PATTERN[key];
  return pattern === 'solid' ? undefined : `url(#${idPrefix}-${pattern})`;
}

/** The four token classes as one stacked bar, in the fixed order output → cache read. */
export function TokenBar({ tokens, height = 10, showLegend = true, ariaLabel, label, fraction }: TokenBarProps) {
  const id = useId().replace(/:/g, '');
  const values: Record<TokenClassKey, number> = {
    output: tokens.output,
    input: tokens.input,
    cacheWrite: tokens.cache5m + tokens.cache1h,
    cacheRead: tokens.cacheRead,
  };
  const total = TOKEN_CLASS_ORDER.reduce((sum, key) => sum + Math.max(0, values[key]), 0);
  const summary =
    ariaLabel ??
    `Token mix: ${TOKEN_CLASS_ORDER.map((key) => `${TOKEN_CLASS_LABEL[key]} ${formatTokensExact(values[key])}`).join(', ')}. Total ${formatTokensExact(total)}.`;

  const trackPercent =
    fraction === undefined ? 100 : Math.max(MIN_FRACTION_PERCENT, Math.min(100, fraction * 100));

  let offset = 0;
  const segments = TOKEN_CLASS_ORDER.map((key) => {
    const value = Math.max(0, values[key]);
    const width = total > 0 ? (value / total) * 100 : 0;
    const segment = { key, value, width, offset };
    offset += width;
    return segment;
  }).filter((segment) => segment.width > 0);

  return (
    <div className={styles.wrap}>
      <div className={styles.barRow}>
        {label ? <span className={styles.label}>{label}</span> : null}
        <span className={styles.track}>
        <svg
          viewBox="0 0 100 10"
          preserveAspectRatio="none"
          height={height}
          className={styles.bar}
          style={{ width: `${trackPercent}%` }}
          role="img"
          aria-label={summary}
        >
          <title>{summary}</title>
          <ChartPatterns idPrefix={id} />
          {total === 0 ? <rect x="0" y="0" width="100" height="10" className={styles.emptyBar} /> : null}
          {segments.map((segment) => (
            <g key={segment.key}>
              <rect
                x={segment.offset}
                y="0"
                width={segment.width}
                height="10"
                style={{ fill: TOKEN_CLASS_COLOR[segment.key] }}
              />
              {patternFor(id, segment.key) ? (
                <rect x={segment.offset} y="0" width={segment.width} height="10" fill={patternFor(id, segment.key)} opacity="0.5" />
              ) : null}
            </g>
          ))}
        </svg>
        </span>
      </div>
      {showLegend ? (
        <ul className={styles.legend}>
          {TOKEN_CLASS_ORDER.map((key) => (
            <li key={key} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: TOKEN_CLASS_COLOR[key] }} data-pattern={TOKEN_CLASS_PATTERN[key]} />
              <span className={styles.legendLabel}>{TOKEN_CLASS_LABEL[key]}</span>
              <span className={['num', styles.legendValue].join(' ')} title={`${formatTokensExact(values[key])} tokens`}>
                {formatTokens(values[key])}
              </span>
              <span className={styles.legendPercent}>{total > 0 ? formatPercent(values[key] / total) : '—'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatMoney, formatPercent, formatTokens, formatTokensExact } from '@/lib/format';
import { ChartPatterns } from '@/components/TokenBar';
import styles from './ContextStrip.module.css';

export interface ContextSegment {
  id: string;
  label: string;
  tokens: number;
  /** estimated dollars this slice of context costs at this request */
  cost?: number;
  /** CSS colour; defaults walk the model/token palette */
  color?: string;
  pattern?: 'solid' | 'hatch' | 'dots' | 'grid';
}

export interface ContextStripProps {
  segments: ContextSegment[];
  /** overrides the summed total (when some context is unaccounted for) */
  total?: number;
  height?: number;
  ariaLabel?: string;
  onSelect?: (segment: ContextSegment) => void;
  selectedId?: string | null;
  showLegend?: boolean;
}

const DEFAULT_COLORS = [
  'var(--m-opus)',
  'var(--t-cache-write)',
  'var(--m-sonnet)',
  'var(--t-input)',
  'var(--m-mythos)',
  'var(--t-cache-read)',
  'var(--m-haiku)',
  'var(--m-other)',
];

/** What fills the context window at one request: system, prompts, output, tool results, hooks. */
export function ContextStrip({
  segments,
  total,
  height = 22,
  ariaLabel = 'What fills the context window',
  onSelect,
  selectedId,
  showLegend = true,
}: ContextStripProps) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(0);
  const sum = segments.reduce((acc, segment) => acc + Math.max(0, segment.tokens), 0);
  const denominator = total ?? sum;
  const summary = `${ariaLabel}: ${segments
    .map((segment) => `${segment.label} ${formatTokensExact(segment.tokens)} tokens`)
    .join(', ')}. Total ${formatTokensExact(denominator)} tokens.`;

  const move = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, segments.length - 1));
    setFocused(clamped);
    ref.current?.querySelector<HTMLElement>(`[data-segment-index="${clamped}"]`)?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(focused + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(focused - 1);
    }
  };

  let offset = 0;
  const laid = segments.map((segment, index) => {
    const width = denominator > 0 ? (Math.max(0, segment.tokens) / denominator) * 100 : 0;
    const placed = { segment, width, offset, color: segment.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length] ?? 'var(--ink-3)' };
    offset += width;
    return placed;
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.barWrap} style={{ height }} role="group" aria-label={summary} ref={ref} onKeyDown={onKeyDown}>
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" className={styles.svg} aria-hidden="true" focusable="false">
          <ChartPatterns idPrefix={id} />
          {laid.map(({ segment, width, offset: left, color }) => (
            <g key={segment.id}>
              <rect x={left} y="0" width={width} height="10" style={{ fill: color }} />
              {segment.pattern && segment.pattern !== 'solid' ? (
                <rect x={left} y="0" width={width} height="10" fill={`url(#${id}-${segment.pattern})`} opacity="0.5" />
              ) : null}
            </g>
          ))}
        </svg>
        <div className={styles.hitLayer}>
          {laid.map(({ segment, width, offset: left }, index) => (
            <button
              key={segment.id}
              type="button"
              data-segment-index={index}
              tabIndex={index === focused ? 0 : -1}
              className={[styles.hit, selectedId === segment.id ? styles.selected : null].filter(Boolean).join(' ')}
              style={{ left: `${left}%`, width: `${width}%` }}
              aria-label={`${segment.label}: ${formatTokensExact(segment.tokens)} tokens${
                segment.cost === undefined ? '' : `, ${formatMoney(segment.cost)} estimated`
              }, ${formatPercent(denominator > 0 ? segment.tokens / denominator : 0)} of context`}
              onFocus={() => setFocused(index)}
              onClick={() => onSelect?.(segment)}
            />
          ))}
        </div>
      </div>
      {showLegend ? (
        <ul className={styles.legend}>
          {laid.map(({ segment, color }) => (
            <li key={segment.id} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: color }} data-pattern={segment.pattern ?? 'solid'} />
              <span className={styles.legendLabel}>{segment.label}</span>
              <span className={['num', styles.legendValue].join(' ')}>{formatTokens(segment.tokens)}</span>
              {segment.cost === undefined ? null : (
                <span className={['num', styles.legendCost].join(' ')}>{formatMoney(segment.cost)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

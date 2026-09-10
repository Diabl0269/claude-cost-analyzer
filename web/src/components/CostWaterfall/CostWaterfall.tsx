import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { scaleLinear } from 'd3-scale';
import { max as d3max } from 'd3-array';
import { ChartFrame } from '@/components/ChartFrame';
import { ChartPatterns, patternFor } from '@/components/TokenBar';
import { LedgerTable, type LedgerColumn } from '@/components/LedgerTable';
import { Money } from '@/components/Money';
import { ModelChip } from '@/components/ModelChip';
import { Button } from '@/components/Button';
import { TOKEN_CLASS_COLOR, TOKEN_CLASS_LABEL, TOKEN_CLASS_ORDER, useElementWidth, type TokenClassKey } from '@/lib/chart';
import { formatDate, formatMoney } from '@/lib/format';
import styles from './CostWaterfall.module.css';

export interface WaterfallDatum {
  /** request seq — the x identity, not a pixel position */
  seq: number;
  ts?: string;
  model?: string;
  total: number;
  /** cost per token class; missing classes are treated as 0 */
  segments: Partial<Record<TokenClassKey, number>>;
}

export interface WaterfallSelection {
  fromSeq: number;
  toSeq: number;
}

export interface CostWaterfallProps {
  data: WaterfallDatum[];
  height?: number;
  title?: string;
  onSelect?: (datum: WaterfallDatum, index: number) => void;
  selectedSeq?: number | null;
  /** drag across the plot (or shift+arrow) to select a run of requests */
  onBrush?: (selection: WaterfallSelection | null) => void;
  ariaLabel?: string;
}

const MARGIN = { top: 10, right: 8, bottom: 22, left: 56 };

/** One bar per request, stacked by token class, x = request order (SPEC §8.3). */
export function CostWaterfall({
  data,
  height = 180,
  title = 'Cost per request',
  onSelect,
  selectedSeq,
  onBrush,
  ariaLabel,
}: CostWaterfallProps) {
  const patternId = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<SVGRectElement | null>(null);
  const width = useElementWidth(wrapRef);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState(0);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [brush, setBrush] = useState<{ from: number; to: number } | null>(null);

  const innerWidth = Math.max(40, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const band = data.length > 0 ? innerWidth / data.length : innerWidth;
  const barWidth = Math.max(1.5, Math.min(20, band - Math.min(3, band * 0.25)));
  const peak = d3max(data, (datum) => datum.total) ?? 0;
  const y = useMemo(() => scaleLinear().domain([0, peak || 1]).range([innerHeight, 0]).nice(4), [peak, innerHeight]);
  const ticks = y.ticks(3);
  // At most five x labels, evenly spaced: request order is dense, so label the ends and a few
  // waypoints rather than every bar.
  const xTicks = useMemo(() => {
    if (data.length === 0) return [];
    const count = Math.min(5, data.length);
    const step = count === 1 ? 0 : (data.length - 1) / (count - 1);
    const seen = new Set<number>();
    const picked: { index: number; datum: WaterfallDatum }[] = [];
    for (let i = 0; i < count; i += 1) {
      const index = Math.round(i * step);
      const datum = data[index];
      if (!datum || seen.has(index)) continue;
      seen.add(index);
      picked.push({ index, datum });
    }
    return picked;
  }, [data]);

  const total = data.reduce((sum, datum) => sum + datum.total, 0);
  const summary =
    ariaLabel ??
    `${title}: ${data.length} requests, ${formatMoney(total)} total, most expensive ${formatMoney(peak)}. Bars are stacked by token class.`;

  const indexFromX = useCallback(
    (clientX: number): number => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect || data.length === 0) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(data.length - 1, Math.floor(ratio * data.length)));
    },
    [data.length],
  );

  const emitBrush = useCallback(
    (range: { from: number; to: number } | null) => {
      setBrush(range);
      if (!onBrush) return;
      if (!range) {
        onBrush(null);
        return;
      }
      const fromSeq = data[Math.min(range.from, range.to)]?.seq;
      const toSeq = data[Math.max(range.from, range.to)]?.seq;
      if (fromSeq === undefined || toSeq === undefined) onBrush(null);
      else onBrush({ fromSeq, toSeq });
    },
    [data, onBrush],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGRectElement>): void => {
    if (!onBrush || event.button !== 0) return;
    const index = indexFromX(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: index, to: index });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGRectElement>): void => {
    const index = indexFromX(event.clientX);
    setHovered(index);
    if (drag) setDrag({ from: drag.from, to: index });
  };

  const onPointerUp = (event: ReactPointerEvent<SVGRectElement>): void => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const range = drag.from === drag.to ? null : { from: Math.min(drag.from, drag.to), to: Math.max(drag.from, drag.to) };
    setDrag(null);
    emitBrush(range);
  };

  const focusBar = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, data.length - 1));
    setFocused(clamped);
    wrapRef.current?.querySelector<HTMLElement>(`[data-bar-index="${clamped}"]`)?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<SVGGElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      const next = Math.max(0, Math.min(focused + step, data.length - 1));
      if (event.shiftKey && onBrush) {
        const start = anchor ?? focused;
        setAnchor(start);
        emitBrush({ from: Math.min(start, next), to: Math.max(start, next) });
      } else {
        setAnchor(null);
        emitBrush(null);
      }
      focusBar(next);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusBar(event.key === 'Home' ? 0 : data.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const datum = data[focused];
      if (datum && onSelect) {
        event.preventDefault();
        onSelect(datum, focused);
      }
      return;
    }
    if (event.key === 'Escape' && (brush || anchor !== null)) {
      setAnchor(null);
      emitBrush(null);
    }
  };

  // Only show the tooltip while the pointer is over the plot or a bar really holds focus —
  // `focused` is just the roving tab stop and is 0 even when nothing is focused.
  const active = hovered ?? (keyboardActive && data[focused] ? focused : null);
  const activeDatum = active === null ? null : data[active];
  const selection = drag ?? brush;

  const columns: LedgerColumn<WaterfallDatum>[] = [
    { id: 'seq', header: '#', numeric: true, width: '64px', cell: (datum) => datum.seq, sortValue: (datum) => datum.seq },
    {
      id: 'ts',
      header: 'Time',
      width: '120px',
      secondary: true,
      cell: (datum) => (datum.ts ? formatDate(datum.ts, 'time') : '—'),
    },
    {
      id: 'model',
      header: 'Model',
      width: '160px',
      cell: (datum) => (datum.model ? <ModelChip model={datum.model} /> : '—'),
    },
    ...TOKEN_CLASS_ORDER.map<LedgerColumn<WaterfallDatum>>((key) => ({
      id: key,
      header: TOKEN_CLASS_LABEL[key],
      numeric: true,
      cell: (datum) => <Money usd={datum.segments[key] ?? 0} />,
      sortValue: (datum) => datum.segments[key] ?? 0,
    })),
    {
      id: 'total',
      header: 'Total',
      numeric: true,
      cell: (datum) => <Money usd={datum.total} />,
      sortValue: (datum) => datum.total,
    },
  ];

  return (
    <ChartFrame
      summary={summary}
      title={title}
      table={
        <LedgerTable
          columns={columns}
          rows={data}
          rowKey={(datum) => String(datum.seq)}
          caption={summary}
          maxHeight={320}
          dense
        />
      }
      toolbar={
        brush && onBrush ? (
          <Button size="sm" variant="ghost" iconStart="close" onClick={() => emitBrush(null)}>
            Clear selection
          </Button>
        ) : null
      }
      legend={TOKEN_CLASS_ORDER.map((key) => (
        <span key={key} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: TOKEN_CLASS_COLOR[key] }} />
          {TOKEN_CLASS_LABEL[key]}
        </span>
      ))}
    >
      <div ref={wrapRef} className={styles.wrap}>
        <svg
          width={width}
          height={height}
          className={styles.svg}
          aria-labelledby={`${patternId}-title ${patternId}-desc`}
        >
          <title id={`${patternId}-title`}>{title}</title>
          <desc id={`${patternId}-desc`}>{summary}</desc>
          <ChartPatterns idPrefix={patternId} />
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line x1="0" x2={innerWidth} className={styles.gridline} />
                <text x="-8" dy="0.32em" className={['num', styles.axisLabel].join(' ')} textAnchor="end">
                  {formatMoney(tick)}
                </text>
              </g>
            ))}
            {selection ? (
              <rect
                x={Math.min(selection.from, selection.to) * band}
                y={0}
                width={(Math.abs(selection.to - selection.from) + 1) * band}
                height={innerHeight}
                className={styles.selectionRect}
              />
            ) : null}
            <g role="list" aria-label={`${data.length} requests`} onKeyDown={onKeyDown} className={styles.bars}>
              {data.map((datum, index) => {
                const centre = index * band + band / 2;
                let cursor = innerHeight;
                const isSelected = selectedSeq === datum.seq;
                return (
                  <g
                    key={datum.seq}
                    role="listitem"
                    tabIndex={index === focused ? 0 : -1}
                    data-bar-index={index}
                    className={[styles.bar, isSelected ? styles.barSelected : null].filter(Boolean).join(' ')}
                    aria-label={`Request ${datum.seq}${datum.model ? `, ${datum.model}` : ''}: ${formatMoney(datum.total)}. ${TOKEN_CLASS_ORDER.map(
                      (key) => `${TOKEN_CLASS_LABEL[key]} ${formatMoney(datum.segments[key] ?? 0)}`,
                    ).join(', ')}`}
                    onFocus={() => {
                      setFocused(index);
                      setKeyboardActive(true);
                    }}
                    onBlur={() => setKeyboardActive(false)}
                    onClick={() => onSelect?.(datum, index)}
                  >
                    {TOKEN_CLASS_ORDER.map((key) => {
                      const value = datum.segments[key] ?? 0;
                      if (value <= 0) return null;
                      const barHeight = Math.max(0.6, innerHeight - y(value));
                      cursor -= barHeight;
                      const pattern = patternFor(patternId, key);
                      return (
                        <g key={key}>
                          <rect
                            x={centre - barWidth / 2}
                            y={cursor}
                            width={barWidth}
                            height={barHeight}
                            style={{ fill: TOKEN_CLASS_COLOR[key] }}
                          />
                          {pattern ? (
                            <rect x={centre - barWidth / 2} y={cursor} width={barWidth} height={barHeight} fill={pattern} opacity="0.45" />
                          ) : null}
                        </g>
                      );
                    })}
                    {isSelected ? (
                      <rect
                        x={centre - barWidth / 2 - 1.5}
                        y={y(datum.total) - 2}
                        width={barWidth + 3}
                        height={innerHeight - y(datum.total) + 2}
                        className={styles.selectedOutline}
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>
            <line x1="0" x2={innerWidth} y1={innerHeight} y2={innerHeight} className={styles.baseline} />
            {xTicks.map(({ index, datum }) => (
              <text
                key={datum.seq}
                x={index * band + band / 2}
                y={innerHeight + 13}
                textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
                className={['num', styles.axisLabel].join(' ')}
              >
                {datum.ts ? formatDate(datum.ts, 'time') : `#${datum.seq}`}
              </text>
            ))}
            <rect
              ref={plotRef}
              x="0"
              y="0"
              width={innerWidth}
              height={innerHeight}
              className={styles.plotSurface}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setHovered(null)}
            />
          </g>
        </svg>
        {activeDatum && active !== null ? (
          <div
            className={styles.tooltip}
            style={{
              left: Math.min(Math.max(MARGIN.left + active * band + band / 2, 90), Math.max(90, width - 90)),
            }}
            role="presentation"
          >
            <p className={styles.tooltipHead}>
              <span className="num">#{activeDatum.seq}</span>
              {activeDatum.ts ? <span className={styles.tooltipTime}>{formatDate(activeDatum.ts, 'time')}</span> : null}
            </p>
            {activeDatum.model ? <ModelChip model={activeDatum.model} /> : null}
            <dl className={styles.tooltipList}>
              {TOKEN_CLASS_ORDER.filter((key) => (activeDatum.segments[key] ?? 0) > 0).map((key) => (
                <div key={key} className={styles.tooltipRow}>
                  <dt>
                    <span className={styles.swatch} style={{ background: TOKEN_CLASS_COLOR[key] }} />
                    {TOKEN_CLASS_LABEL[key]}
                  </dt>
                  <dd>
                    <Money usd={activeDatum.segments[key] ?? 0} />
                  </dd>
                </div>
              ))}
              <div className={[styles.tooltipRow, styles.tooltipTotal].join(' ')}>
                <dt>Total</dt>
                <dd>
                  <Money usd={activeDatum.total} />
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}

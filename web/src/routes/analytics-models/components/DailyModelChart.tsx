import { useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { max as d3max } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import type { ModelCostRow, ModelsAnalyticsResponse } from '@core/types';
import { ChartFrame, LedgerTable, Money, type LedgerColumn } from '@/components';
import { MODEL_FAMILY_COLOR, useElementWidth } from '@/lib/chart';
import type { CurrencyDisplay } from '@/lib/format';
import { formatDayLabel, formatMoney } from '@/lib/format';
import styles from './DailyModelChart.module.css';

const MARGIN = { top: 10, right: 8, bottom: 22, left: 58 };
const PATTERNS = ['solid', 'hatch', 'dots', 'grid'] as const;
type PatternName = (typeof PATTERNS)[number];

export interface ModelSeries {
  model: string;
  label: string;
  color: string;
  pattern: PatternName;
}

/**
 * One series per model: family hue for the colour, and a fill pattern that increments within a
 * family, so two Opus models are still told apart in greyscale (SPEC §9).
 */
export function buildSeries(models: ModelCostRow[]): ModelSeries[] {
  const used = new Map<string, number>();
  return [...models]
    .sort((a, b) => b.cost.total - a.cost.total)
    .map((model) => {
      const index = used.get(model.family) ?? 0;
      used.set(model.family, index + 1);
      return {
        model: model.model,
        label: model.label,
        color: MODEL_FAMILY_COLOR[model.family],
        pattern: PATTERNS[index % PATTERNS.length] as PatternName,
      };
    });
}

function Patterns({ idPrefix, series }: { idPrefix: string; series: ModelSeries[] }) {
  const needed = [...new Set(series.map((entry) => entry.pattern))].filter((pattern) => pattern !== 'solid');
  return (
    <defs>
      {needed.map((pattern) => (
        <pattern key={pattern} id={`${idPrefix}-${pattern}`} width="4" height="4" patternUnits="userSpaceOnUse">
          {pattern === 'hatch' ? <path d="M0 4 L4 0" stroke="rgba(255,255,255,.65)" strokeWidth="1" /> : null}
          {pattern === 'dots' ? <circle cx="1" cy="1" r="0.9" fill="rgba(255,255,255,.7)" /> : null}
          {pattern === 'grid' ? <path d="M0 0 H4 M0 0 V4" stroke="rgba(255,255,255,.55)" strokeWidth="0.8" /> : null}
        </pattern>
      ))}
    </defs>
  );
}

export interface DailyModelChartProps {
  daily: ModelsAnalyticsResponse['daily'];
  models: ModelCostRow[];
  currency: CurrencyDisplay;
  height?: number;
  /**
   * When given, the frame renders the section's own `<h2 id>` in its caption, so the heading,
   * the legend and the Chart/Table toggle share one row instead of stacking.
   */
  headingId?: string;
}

/** Daily spend stacked by model — the shape of a month, one bar per day. */
export function DailyModelChart({ daily, models, currency, height = 220, headingId }: DailyModelChartProps) {
  const patternId = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(wrapRef);
  const [focused, setFocused] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const series = useMemo(() => buildSeries(models), [models]);
  const days = useMemo(
    () =>
      daily.map((day) => ({
        date: day.date,
        byModel: day.byModel,
        total: Object.values(day.byModel).reduce((sum, value) => sum + value, 0),
      })),
    [daily],
  );

  const innerWidth = Math.max(40, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const band = days.length > 0 ? innerWidth / days.length : innerWidth;
  const barWidth = Math.max(2, Math.min(28, band - Math.max(2, band * 0.22)));
  const peak = d3max(days, (day) => day.total) ?? 0;
  const y = useMemo(() => scaleLinear().domain([0, peak || 1]).range([innerHeight, 0]).nice(4), [peak, innerHeight]);

  const total = days.reduce((sum, day) => sum + day.total, 0);
  const busiest = days.reduce<(typeof days)[number] | null>((best, day) => (best && best.total >= day.total ? best : day), null);
  const summary = `Daily spend by model: ${days.length} days, ${formatMoney(total)} in total${
    busiest ? `, peaking at ${formatMoney(busiest.total)} on ${formatDayLabel(busiest.date)}` : ''
  }. Each bar is stacked by model.`;

  const xTicks = useMemo(() => {
    if (days.length === 0) return [];
    const count = Math.min(6, days.length);
    const step = count === 1 ? 0 : (days.length - 1) / (count - 1);
    const seen = new Set<number>();
    return Array.from({ length: count }, (_, i) => Math.round(i * step)).filter((index) => {
      if (seen.has(index)) return false;
      seen.add(index);
      return true;
    });
  }, [days]);

  const focusDay = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, days.length - 1));
    setFocused(clamped);
    wrapRef.current?.querySelector<HTMLElement>(`[data-day-index="${clamped}"]`)?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<SVGGElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      focusDay(focused + step);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusDay(event.key === 'Home' ? 0 : days.length - 1);
    }
  };

  const columns = useMemo<LedgerColumn<(typeof days)[number]>[]>(
    () => [
      { id: 'date', header: 'Day', sortValue: (day) => day.date, cell: (day) => formatDayLabel(day.date) },
      ...series.map<LedgerColumn<(typeof days)[number]>>((entry) => ({
        id: entry.model,
        header: entry.label,
        numeric: true,
        sortValue: (day) => day.byModel[entry.model] ?? 0,
        cell: (day) => <Money usd={day.byModel[entry.model] ?? 0} currency={currency} />,
      })),
      {
        id: 'total',
        header: 'Total',
        numeric: true,
        sortValue: (day) => day.total,
        cell: (day) => <Money usd={day.total} currency={currency} />,
      },
    ],
    [series, currency],
  );

  const activeDay = active === null ? null : days[active];

  return (
    <ChartFrame
      summary={summary}
      {...(headingId ? { heading: { id: headingId, text: 'Daily spend by model' } } : {})}
      table={
        <LedgerTable
          columns={columns}
          rows={days}
          rowKey={(day) => day.date}
          caption="Daily spend by model"
          defaultSort={{ columnId: 'date', direction: 'asc' }}
          maxHeight={360}
          dense
        />
      }
      legend={
        <p className={styles.legend}>
          {series.map((entry) => (
            <span key={entry.model} className={styles.legendItem}>
              <svg width="11" height="11" aria-hidden="true">
                <rect width="11" height="11" rx="2" fill={entry.color} />
                {entry.pattern === 'solid' ? null : <rect width="11" height="11" rx="2" fill={`url(#${patternId}-${entry.pattern})`} opacity="0.55" />}
              </svg>
              {entry.label}
            </span>
          ))}
        </p>
      }
    >
      <div ref={wrapRef} className={styles.wrap}>
        <svg width={width} height={height} className={styles.svg} aria-labelledby={`${patternId}-t ${patternId}-d`}>
          <title id={`${patternId}-t`}>Daily spend by model</title>
          <desc id={`${patternId}-d`}>{summary}</desc>
          <Patterns idPrefix={patternId} series={series} />
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {y.ticks(4).map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line x1="0" x2={innerWidth} className={styles.gridline} />
                <text x="-8" dy="0.32em" textAnchor="end" className={`num ${styles.axisLabel}`}>
                  {formatMoney(tick, currency)}
                </text>
              </g>
            ))}
            <g role="list" aria-label={`${days.length} days`} onKeyDown={onKeyDown}>
              {days.map((day, index) => {
                let cursor = innerHeight;
                const centre = index * band + band / 2;
                return (
                  <g
                    key={day.date}
                    role="listitem"
                    tabIndex={index === focused ? 0 : -1}
                    data-day-index={index}
                    className={[styles.day, active === index ? styles.active : null].filter(Boolean).join(' ')}
                    aria-label={`${formatDayLabel(day.date)}: ${formatMoney(day.total, currency)}. ${series
                      .filter((entry) => (day.byModel[entry.model] ?? 0) > 0)
                      .map((entry) => `${entry.label} ${formatMoney(day.byModel[entry.model] ?? 0, currency)}`)
                      .join(', ')}`}
                    onFocus={() => {
                      setFocused(index);
                      setActive(index);
                    }}
                    onBlur={() => setActive(null)}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() => setActive(null)}
                  >
                    <rect x={index * band} y={0} width={band} height={innerHeight} fill="transparent" />
                    {series.map((entry) => {
                      const value = day.byModel[entry.model] ?? 0;
                      if (value <= 0) return null;
                      const barHeight = Math.max(0.6, innerHeight - y(value));
                      cursor -= barHeight;
                      return (
                        <g key={entry.model}>
                          <rect x={centre - barWidth / 2} y={cursor} width={barWidth} height={barHeight} fill={entry.color} />
                          {entry.pattern === 'solid' ? null : (
                            <rect
                              x={centre - barWidth / 2}
                              y={cursor}
                              width={barWidth}
                              height={barHeight}
                              fill={`url(#${patternId}-${entry.pattern})`}
                              opacity="0.5"
                            />
                          )}
                        </g>
                      );
                    })}
                    <rect
                      className={styles.focusRing}
                      x={centre - barWidth / 2 - 2}
                      y={y(day.total) - 2}
                      width={barWidth + 4}
                      height={innerHeight - y(day.total) + 4}
                      rx="2"
                    />
                  </g>
                );
              })}
            </g>
            <line x1="0" x2={innerWidth} y1={innerHeight} y2={innerHeight} className={styles.baseline} />
            {xTicks.map((index) => {
              const day = days[index];
              if (!day) return null;
              return (
                <text
                  key={day.date}
                  x={index * band + band / 2}
                  y={innerHeight + 14}
                  textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'}
                  className={`num ${styles.axisLabel}`}
                >
                  {formatDayLabel(day.date)}
                </text>
              );
            })}
          </g>
        </svg>
        {activeDay && active !== null ? (
          <div
            className={styles.tooltip}
            style={{ left: Math.min(Math.max(MARGIN.left + active * band + band / 2, 100), Math.max(100, width - 100)) }}
          >
            <div className={styles.tooltipHead}>
              <span>{formatDayLabel(activeDay.date)}</span>
              <Money usd={activeDay.total} currency={currency} />
            </div>
            {series
              .filter((entry) => (activeDay.byModel[entry.model] ?? 0) > 0)
              .map((entry) => (
                <div key={entry.model} className={styles.tooltipRow}>
                  <span>
                    <span className={styles.swatch} style={{ background: entry.color }} aria-hidden="true" />
                    {entry.label}
                  </span>
                  <Money usd={activeDay.byModel[entry.model] ?? 0} currency={currency} />
                </div>
              ))}
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}

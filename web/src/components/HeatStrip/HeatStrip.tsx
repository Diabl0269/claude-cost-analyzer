import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { plural } from '@core/pricing/format.js';
import { formatDate, formatMoney, fromIsoDay } from '@/lib/format';
import { HEAT_STEPS, heatStep } from '@/lib/chart';
import styles from './HeatStrip.module.css';

export interface HeatDay {
  /** local `YYYY-MM-DD` */
  date: string;
  cost: number;
  requests?: number;
  sessions?: number;
}

export interface HeatStripProps {
  days: HeatDay[];
  onSelect?: (day: HeatDay) => void;
  selectedDate?: string | null;
  ariaLabel?: string;
  height?: number;
  showLegend?: boolean;
  /** first/last date under the strip, so the axis names itself */
  showAxis?: boolean;
}

function dayLabel(date: string): string {
  return formatDate(fromIsoDay(date), 'date');
}

function describe(day: HeatDay): string {
  if (day.cost <= 0 && !day.requests) return `${dayLabel(day.date)} · nothing billed`;
  const parts = [dayLabel(day.date), formatMoney(day.cost)];
  if (day.requests !== undefined) parts.push(plural(day.requests, 'request'));
  if (day.sessions !== undefined) parts.push(plural(day.sessions, 'session'));
  return parts.join(' · ');
}

/** One cell per day, keyboard navigable, colour plus a tooltip — never colour alone. */
export function HeatStrip({
  days,
  onSelect,
  selectedDate,
  ariaLabel = 'Daily spend',
  height = 26,
  showLegend = true,
  showAxis = true,
}: HeatStripProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(0);
  // Whether the reader has actually put the caret on a cell. Until then the caption summarises
  // the whole range instead of narrating day one, which used to read as "the strip is about
  // Aug 11" on every page load.
  const [visited, setVisited] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  let max = 0;
  let peak: HeatDay | null = null;
  for (const day of days) {
    if (day.cost > max) {
      max = day.cost;
      peak = day;
    }
  }

  const move = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, days.length - 1));
    setFocused(clamped);
    ref.current?.querySelector<HTMLElement>(`[data-day-index="${clamped}"]`)?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(focused + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(focused - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(days.length - 1);
    }
  };

  const active = hovered ?? (visited && days[focused] ? focused : null);
  const activeDay = active === null ? null : days[active];
  const first = days[0];
  const last = days[days.length - 1];
  const summary = peak
    ? `${plural(days.length, 'day')} · peak ${formatMoney(max)} on ${dayLabel(peak.date)}`
    : `${plural(days.length, 'day')} · nothing billed`;

  return (
    <div className={styles.wrap}>
      {/* The cell count sizes the block, so the axis under the strip is exactly as wide as the
          cells above it. `max-content` cannot do this: an empty flex item contributes nothing. */}
      <div className={styles.calendar} style={{ ['--days' as string]: days.length }}>
        <div
          ref={ref}
          className={styles.strip}
          style={{ height }}
          role="group"
          aria-label={`${ariaLabel}, ${plural(days.length, 'day')}`}
          onKeyDown={onKeyDown}
          onPointerLeave={() => setHovered(null)}
        >
          {days.map((day, index) => {
            // `null` is "nothing billed": no step of the ramp, drawn as bare paper below.
            const step = heatStep(day.cost, max);
            const billed = step !== null;
            return (
              <button
                key={day.date}
                type="button"
                data-day-index={index}
                tabIndex={index === focused ? 0 : -1}
                aria-label={describe(day)}
                aria-pressed={selectedDate === day.date}
                className={[styles.cell, billed ? null : styles.blank, selectedDate === day.date ? styles.selected : null]
                  .filter(Boolean)
                  .join(' ')}
                // A day that billed nothing keeps its cell — drawn as bare paper inside a hairline,
                // so the gap in the calendar is visible instead of being squeezed out of existence.
                style={step === null ? undefined : { background: HEAT_STEPS[step] }}
                onPointerEnter={() => setHovered(index)}
                onFocus={() => {
                  setFocused(index);
                  setVisited(true);
                }}
                onClick={() => onSelect?.(day)}
              />
            );
          })}
        </div>
        {showAxis && first && last ? (
          <div className={styles.axis} aria-hidden="true">
            <span>{dayLabel(first.date)}</span>
            {last.date === first.date ? null : <span>{dayLabel(last.date)}</span>}
          </div>
        ) : null}
      </div>
      <div className={styles.footer}>
        {/* Not a live region: every day is a button carrying `describe(day)` as its own label, so
            focusing one already says it. Announcing here too said everything twice, and once more
            for every day the pointer crossed on its way. */}
        <p className={styles.readout}>{activeDay ? describe(activeDay) : summary}</p>
        {showLegend ? (
          <div className={styles.legend}>
            <span>less</span>
            {HEAT_STEPS.map((color, index) => (
              <span key={color} className={styles.legendCell} style={{ background: color }} aria-hidden="true" data-step={index} />
            ))}
            <span>more</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

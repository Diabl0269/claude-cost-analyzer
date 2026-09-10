import { useId } from 'react';
import { max, min } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import styles from './Sparkline.module.css';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** required: the trend has to be readable without seeing it */
  ariaLabel: string;
  tone?: 'ink' | 'cost' | 'save' | 'info';
  /** fills under the line */
  fill?: boolean;
  /** marks the last point */
  marker?: boolean;
}

/** Tiny trend line. SVG is drawn here; d3 only does the maths. */
export function Sparkline({ values, width = 96, height = 24, ariaLabel, tone = 'ink', fill = true, marker = true }: SparklineProps) {
  const id = useId();
  const padding = 2;
  const lowest = min(values) ?? 0;
  const highest = max(values) ?? 1;
  const x = scaleLinear()
    .domain([0, Math.max(1, values.length - 1)])
    .range([padding, width - padding]);
  const y = scaleLinear()
    .domain([Math.min(0, lowest), highest === lowest ? highest + 1 : highest])
    .range([height - padding, padding]);

  const path = line<number>()
    .x((_, index) => x(index))
    .y((value) => y(value))
    .curve(curveMonotoneX)(values);

  const filled = area<number>()
    .x((_, index) => x(index))
    .y0(height - padding)
    .y1((value) => y(value))
    .curve(curveMonotoneX)(values);

  const lastValue = values[values.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={styles.sparkline}
      data-tone={tone}
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      {fill && filled ? (
        <>
          <defs>
            <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={filled} fill={`url(#${id}-fade)`} stroke="none" />
        </>
      ) : null}
      {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {marker && lastValue !== undefined ? (
        <circle cx={x(values.length - 1)} cy={y(lastValue)} r="1.9" fill="currentColor" />
      ) : null}
    </svg>
  );
}

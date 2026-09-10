import { useId, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@/components/SegmentedControl';
import styles from './ChartFrame.module.css';

export interface ChartFrameProps {
  /** one-sentence description of the whole graphic, read by screen readers */
  summary: string;
  children: ReactNode;
  title?: ReactNode;
  /** the same data as a LedgerTable; enables the "Show as table" toggle */
  table?: ReactNode;
  toolbar?: ReactNode;
  defaultView?: 'chart' | 'table';
  /** the key to the chart's colours; sits on the title line, right of the title */
  legend?: ReactNode;
  /**
   * The section's own heading, rendered inside the caption. Use it instead of stacking a
   * `<Section>` heading above the frame — the section heading, the legend and the Chart|Table
   * toggle then share one row instead of costing a band of blank paper. Wrap the frame in a
   * `<section aria-labelledby={heading.id}>` so the region is still named.
   */
  heading?: { id: string; level?: 'h2' | 'h3'; text: ReactNode; note?: ReactNode };
}

/**
 * Shared wrapper for every chart (SPEC §8.3): a caption, the accessible summary and
 * the "Show as table" switch that renders the same numbers in a LedgerTable.
 *
 * Title, legend and view toggle share one baseline. They used to be three stacked rows — a
 * caption line, the chart, then the legend, with the toggle alone on a line of its own — which
 * cost every analytical page about 60px of blank paper above the first data mark.
 */
export function ChartFrame({ summary, children, title, table, toolbar, defaultView = 'chart', legend, heading }: ChartFrameProps) {
  const id = useId();
  const [view, setView] = useState<'chart' | 'table'>(defaultView);
  const showTable = Boolean(table) && view === 'table';
  const Heading = heading?.level ?? 'h2';
  const caption = heading ? (
    <span className={styles.captionHeading}>
      <Heading id={heading.id}>{heading.text}</Heading>
      {heading.note ? <span className="ui-xs muted-2">{heading.note}</span> : null}
    </span>
  ) : (
    title
  );

  return (
    <figure className={styles.frame} aria-labelledby={`${id}-caption`}>
      <div className={styles.header}>
        <figcaption id={`${id}-caption`} className={caption ? styles.caption : 'visually-hidden'}>
          {caption ?? summary}
        </figcaption>
        {legend && !showTable ? <div className={styles.legend}>{legend}</div> : null}
        {toolbar || table ? (
          <div className={styles.tools} data-print-hide>
            {toolbar}
            {table ? (
              <SegmentedControl
                label="Chart or table view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'chart', label: 'Chart', icon: 'chart', title: 'Show as chart' },
                  { value: 'table', label: 'Table', icon: 'table', title: 'Show as table' },
                ]}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="visually-hidden">{summary}</p>
      <div className={styles.body}>{showTable ? table : children}</div>
    </figure>
  );
}

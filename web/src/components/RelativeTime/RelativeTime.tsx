import { useEffect, useState, type TimeHTMLAttributes } from 'react';
import { formatDate, relativeTime, toDate } from '@/lib/format';

export interface RelativeTimeProps extends Omit<TimeHTMLAttributes<HTMLTimeElement>, 'children' | 'dateTime'> {
  value: string | number | Date | null | undefined;
  /** re-render every minute so "4m ago" stays true */
  live?: boolean;
}

export function RelativeTime({ value, live = true, className, ...rest }: RelativeTimeProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, [live]);

  const date = toDate(value);
  if (!date) return <span className={className}>—</span>;
  return (
    <time dateTime={date.toISOString()} title={formatDate(date, 'datetime')} className={className} {...rest}>
      {relativeTime(date)}
    </time>
  );
}

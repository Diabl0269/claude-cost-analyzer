import type { HTMLAttributes } from 'react';
import { formatDuration } from '@/lib/format';

export interface DurationProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  ms: number | null | undefined;
}

/** Wall-clock duration in tabular numerals; the title carries raw milliseconds. */
export function Duration({ ms, className, ...rest }: DurationProps) {
  return (
    <span className={['num', className].filter(Boolean).join(' ')} title={ms == null ? undefined : `${Math.round(ms)} ms`} {...rest}>
      {formatDuration(ms)}
    </span>
  );
}

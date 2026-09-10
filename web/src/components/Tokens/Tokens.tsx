import type { HTMLAttributes } from 'react';
import { formatTokens, formatTokensFull } from '@/lib/format';
import styles from './Tokens.module.css';

export interface TokensProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number | null | undefined;
  /** appended in muted type, e.g. `tok` */
  unit?: string;
}

/** Compact token count (`12.4K`) with the exact figure in the title. */
export function Tokens({ value, unit, className, ...rest }: TokensProps) {
  return (
    <span className={['num', styles.tokens, className].filter(Boolean).join(' ')} title={value == null ? undefined : formatTokensFull(value)} {...rest}>
      {formatTokens(value)}
      {unit ? <span className={styles.unit}> {unit}</span> : null}
    </span>
  );
}

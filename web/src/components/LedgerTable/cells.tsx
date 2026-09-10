import { Icon } from '@/components/Icon';
import { formatCount } from '@/lib/format';
import styles from './LedgerTable.module.css';

export interface CountCellProps {
  value: number;
  /**
   * `warn` for something that merely wants attention (a hook that timed out), `cost` for a
   * failure that cost money (an errored tool call).
   */
  tone?: 'warn' | 'cost';
  /** what one of these is, for the tooltip: "failures", "timeouts" */
  noun?: string;
}

/**
 * A count of things that went wrong. Zero is dimmed to `--ink-3` — it is the answer nobody has
 * to read — and a non-zero count is coloured **and** carries a glyph, because colour is never
 * the only channel (SPEC §9). Shared by the tools and hooks tables so "0" and "139" never
 * arrive in the same ink again.
 */
export function CountCell({ value, tone = 'warn', noun }: CountCellProps) {
  if (!Number.isFinite(value) || value === 0) {
    return <span className={styles.countZero}>0</span>;
  }
  const label = noun ? `${formatCount(value)} ${noun}` : undefined;
  return (
    <span className={`${styles.countFlag} ${tone === 'cost' ? styles.countCost : styles.countWarn}`} title={label}>
      <Icon name="warning" size={11} />
      {formatCount(value)}
    </span>
  );
}

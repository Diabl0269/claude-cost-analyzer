import type { ReactNode } from 'react';
import styles from './Receipt.module.css';

export interface ReceiptRow {
  id: string;
  label: ReactNode;
  value: ReactNode;
  /** small grey line under the label */
  note?: ReactNode;
  /** 0, 1 or 2 levels of indent for sub-totals */
  indent?: 0 | 1 | 2;
  /** `total` draws a rule above and sets the value in display numerals */
  emphasis?: 'normal' | 'total' | 'subtotal' | 'muted';
}

export interface ReceiptProps {
  rows: ReceiptRow[];
  /** rendered as the receipt's heading */
  caption?: ReactNode;
  footer?: ReactNode;
  dense?: boolean;
}

/**
 * Label……amount rows with dotted leaders — the session summary format.
 * Rendered as a description list so the label/value pairing survives a screen reader.
 */
export function Receipt({ rows, caption, footer, dense = false }: ReceiptProps) {
  return (
    <div className={[styles.receipt, dense ? styles.dense : null].filter(Boolean).join(' ')}>
      {caption ? <p className={styles.caption}>{caption}</p> : null}
      <dl className={styles.list}>
        {rows.map((row) => (
          <div
            key={row.id}
            className={styles.row}
            data-emphasis={row.emphasis ?? 'normal'}
            style={row.indent ? { paddingLeft: `calc(var(--s4) * ${row.indent})` } : undefined}
          >
            <dt className={styles.label}>
              <span className={styles.labelText}>{row.label}</span>
              {row.note ? <span className={styles.note}>{row.note}</span> : null}
            </dt>
            <span className={styles.leader} aria-hidden="true" />
            <dd className={styles.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}

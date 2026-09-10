import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** renders N stacked bars with a ragged last line */
  lines?: number;
  radius?: number | string;
  className?: string;
  /** announced by screen readers as the loading state of a region */
  label?: string;
}

/** Placeholder block. Purely decorative unless `label` is given. */
export function Skeleton({ width = '100%', height = 12, lines = 1, radius = 'var(--r1)', className, label }: SkeletonProps) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  if (lines > 1) {
    return (
      <div className={[styles.stack, className].filter(Boolean).join(' ')} role={label ? 'status' : undefined} aria-label={label}>
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={styles.bar}
            style={{ ...style, width: index === lines - 1 ? '62%' : style.width }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }
  return (
    <span
      className={[styles.bar, className].filter(Boolean).join(' ')}
      style={style}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

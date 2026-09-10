import { Skeleton } from '@/components';
import styles from './Overview.module.css';

/** Six KPI cells, a strip, two receipts — the same slots the loaded page fills. */
const KPI_CELLS = 6;
const RECEIPT_ROWS = [6, 14];

/**
 * The overview while it loads. Three grey slabs told the reader nothing about what was coming
 * and then relaid the page out under them; this mirrors the real layout — the KPI row with its
 * six cells and hairlines, the daily strip, the two receipts of "Where the money went" — so the
 * first paint and the second occupy the same shape.
 */
export function OverviewSkeleton() {
  return (
    <div className="stack stack-lg" aria-busy="true">
      <div className="grid-kpis grid-kpis-6" aria-hidden="true">
        {Array.from({ length: KPI_CELLS }, (_, index) => (
          <div key={index} className={styles.skeletonKpi}>
            <Skeleton width={index === 2 ? 104 : 72} height={9} />
            <Skeleton width={index === 0 ? 140 : 96} height={index === 0 ? 30 : 22} />
            <Skeleton width={64} height={9} />
          </div>
        ))}
      </div>

      <div className={styles.skeletonStrip}>
        <Skeleton width={120} height={13} label="Loading the overview" />
        <Skeleton height={26} />
        <div className={styles.skeletonStripFoot}>
          <Skeleton width={180} height={9} />
          <Skeleton width={110} height={9} />
        </div>
      </div>

      <div className={styles.split} aria-hidden="true">
        {RECEIPT_ROWS.map((rows, index) => (
          <div key={index} className={styles.receiptPanel}>
            <Skeleton width={index === 0 ? 168 : 232} height={12} />
            <Skeleton lines={rows} height={10} />
          </div>
        ))}
      </div>
    </div>
  );
}

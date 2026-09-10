import type { ReactNode } from 'react';
import { ChartFrame } from '@/components/ChartFrame';
import { Receipt } from '@/components/Receipt';
import { Money } from '@/components/Money';
import { formatMoney, formatPercent } from '@/lib/format';
import styles from './PlanGauge.module.css';

export interface PlanGaugeProps {
  /** e.g. "Max 20×" */
  planLabel: string;
  planUsd: number;
  /** API list price for the same period */
  apiUsd: number;
  /** linear run-rate projection to month end */
  forecastUsd?: number;
  month?: string;
  title?: string;
}

/** Subscription versus pay-per-token for one month (SPEC §10.1). */
export function PlanGauge({ planLabel, planUsd, apiUsd, forecastUsd, month, title = 'Plan vs pay-per-token' }: PlanGaugeProps) {
  const peak = Math.max(planUsd, apiUsd, forecastUsd ?? 0, 0.01);
  const delta = apiUsd - planUsd;
  const cheaper = delta < 0;
  const summary = `${month ? `${month}: ` : ''}the ${planLabel} plan costs ${formatMoney(planUsd)}; the same usage at API list prices costs ${formatMoney(
    apiUsd,
  )}${forecastUsd === undefined ? '' : `, forecast ${formatMoney(forecastUsd)} by month end`}. Pay-per-token is ${formatMoney(
    Math.abs(delta),
  )} ${cheaper ? 'cheaper' : 'more expensive'}.`;

  const bar = (label: string, value: number, tone: 'plan' | 'api'): ReactNode => (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.track}>
        <div className={styles.fill} data-tone={tone} style={{ width: `${Math.max(1, (value / peak) * 100)}%` }} />
        {forecastUsd !== undefined && tone === 'api' ? (
          <div
            className={styles.forecast}
            style={{ left: `${Math.min(100, (forecastUsd / peak) * 100)}%` }}
            title={`Forecast ${formatMoney(forecastUsd)}`}
          />
        ) : null}
      </div>
      <Money usd={value} className={styles.rowValue} />
    </div>
  );

  return (
    <ChartFrame
      summary={summary}
      title={title}
      table={
        <Receipt
          rows={[
            { id: 'plan', label: `${planLabel} plan`, value: <Money usd={planUsd} /> },
            { id: 'api', label: 'API list price', value: <Money usd={apiUsd} /> },
            ...(forecastUsd === undefined
              ? []
              : [{ id: 'forecast', label: 'Forecast at month end', value: <Money usd={forecastUsd} />, emphasis: 'muted' as const }]),
            {
              id: 'delta',
              label: cheaper ? 'Saved by paying per token' : 'Extra cost per token',
              value: <Money usd={Math.abs(delta)} tone={cheaper ? 'save' : 'cost'} />,
              emphasis: 'total',
            },
          ]}
        />
      }
    >
      <div className={styles.gauge}>
        {bar(`${planLabel} plan`, planUsd, 'plan')}
        {bar('Pay-per-token', apiUsd, 'api')}
        <p className={styles.verdict} data-tone={cheaper ? 'save' : 'cost'}>
          {cheaper ? 'Pay-per-token is cheaper by ' : 'Pay-per-token costs more by '}
          <Money usd={Math.abs(delta)} tone={cheaper ? 'save' : 'cost'} />
          {planUsd > 0 ? <span className={styles.share}> ({formatPercent(Math.abs(delta) / planUsd)} of the plan)</span> : null}
          {forecastUsd === undefined ? null : (
            <span className={styles.share}>
              {' '}
              · forecast <Money usd={forecastUsd} />
            </span>
          )}
        </p>
      </div>
    </ChartFrame>
  );
}

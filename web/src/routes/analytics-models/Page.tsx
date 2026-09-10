import { useMemo } from 'react';
import type { ModelCostRow, Speed } from '@core/types';
import { plural } from '@core/pricing/format';
import {
  EmptyState,
  Kpi,
  LedgerTable,
  ModelChip,
  Money,
  Receipt,
  Skeleton,
  Tokens,
  columnFractionDigits,
  type LedgerColumn,
  type ReceiptRow,
} from '@/components';
import { ShareBar } from '@/lib/bars';
import { useCurrency } from '@/lib/currency';
import { formatCount, formatPercent } from '@/lib/format';
import { PageHeader, QueryError, Section } from '@/lib/page';
import { useModelsAnalytics } from '@/lib/queries';
import { useDateRange } from '@/lib/range';
import { DailyModelChart } from './components';
import styles from './Page.module.css';

const SPEED_LABEL: Record<Speed, string> = { standard: 'Standard', fast: 'Fast' };

/** Which models the money went to, and how that mix moved day by day. */
export default function ModelsAnalyticsPage() {
  const range = useDateRange();
  const currency = useCurrency();
  const models = useModelsAnalytics(range.query);

  const rows = useMemo(() => [...(models.data?.models ?? [])].sort((a, b) => b.cost.total - a.cost.total), [models.data]);
  const total = rows.reduce((sum, row) => sum + row.cost.total, 0);
  const requests = rows.reduce((sum, row) => sum + row.requests, 0);
  const outputTokens = rows.reduce((sum, row) => sum + row.tokens.output, 0);
  const contextTokens = rows.reduce((sum, row) => sum + row.tokens.context, 0);
  const leader = rows[0] ?? null;

  const columns = useMemo<LedgerColumn<ModelCostRow>[]>(
    () => [
      {
        id: 'model',
        header: 'Model',
        width: '20%',
        sortValue: (row) => row.label,
        cell: (row) => (
          <span className="cluster" style={{ gap: 'var(--s2)' }}>
            <ModelChip model={row.model} label={row.label} family={row.family} />
            {row.unpriced ? <span className="ui-xs muted-2">unpriced</span> : null}
          </span>
        ),
      },
      { id: 'requests', header: 'Requests', numeric: true, sortValue: (row) => row.requests, cell: (row) => formatCount(row.requests) },
      {
        id: 'outputTok',
        header: 'Output tok',
        numeric: true,
        secondary: true,
        sortValue: (row) => row.tokens.output,
        cell: (row) => <Tokens value={row.tokens.output} />,
      },
      {
        id: 'thinkingTok',
        header: 'Thinking tok',
        numeric: true,
        secondary: true,
        headerTitle: 'Included in output tokens, reported separately by the API',
        sortValue: (row) => row.tokens.thinking,
        cell: (row) => <Tokens value={row.tokens.thinking} />,
      },
      {
        id: 'contextTok',
        header: 'Context tok',
        numeric: true,
        secondary: true,
        sortValue: (row) => row.tokens.context,
        cell: (row) => <Tokens value={row.tokens.context} />,
      },
      {
        id: 'outputCost',
        header: 'Output',
        numeric: true,
        sortValue: (row) => row.cost.output,
        cell: (row) => <Money usd={row.cost.output} currency={currency} />,
      },
      {
        id: 'cacheWrite',
        header: 'Cache write',
        numeric: true,
        sortValue: (row) => row.cost.cacheWrite,
        cell: (row) => <Money usd={row.cost.cacheWrite} currency={currency} />,
      },
      {
        id: 'cacheRead',
        header: 'Cache read',
        numeric: true,
        sortValue: (row) => row.cost.cacheRead,
        cell: (row) => <Money usd={row.cost.cacheRead} currency={currency} />,
      },
      {
        id: 'share',
        header: 'Share',
        width: '10%',
        sortValue: (row) => row.cost.total,
        cell: (row) => <ShareBar fraction={total > 0 ? row.cost.total / total : 0} />,
        headerTitle: 'Share of range spend',
      },
      // Two figures never share a cell: the percentage in the same box as the money left the
      // footer's total sitting under a mix of both, aligned to neither.
      {
        id: 'sharePct',
        header: '%',
        numeric: true,
        headerTitle: 'Share of range spend',
        sortValue: (row) => row.cost.total,
        cell: (row) => <span className="muted-2">{formatPercent(total > 0 ? row.cost.total / total : 0)}</span>,
      },
      {
        id: 'total',
        header: 'Total',
        numeric: true,
        sortValue: (row) => row.cost.total,
        cell: (row) => <Money usd={row.cost.total} currency={currency} />,
      },
    ],
    [currency, total],
  );

  const speedRows = useMemo<ReceiptRow[]>(() => {
    const list = models.data?.bySpeed ?? [];
    const speedTotal = list.reduce((sum, row) => sum + row.cost, 0);
    // One decimal slot for the whole receipt, so its dotted leaders end on one vertical line.
    const speedDigits = columnFractionDigits([...list.map((row) => row.cost), speedTotal]) ?? 2;
    return [
      ...list.map<ReceiptRow>((row) => ({
        id: row.speed,
        label: SPEED_LABEL[row.speed] ?? row.speed,
        value: <Money usd={row.cost} currency={currency} fractionDigits={speedDigits} />,
        note: `${plural(row.requests, 'request')} · ${formatPercent(speedTotal > 0 ? row.cost / speedTotal : 0)}`,
      })),
      {
        id: 'total',
        label: 'Total',
        value: <Money usd={speedTotal} currency={currency} fractionDigits={speedDigits} display />,
        emphasis: 'total',
      },
    ];
  }, [models.data, currency]);

  return (
    <div className={`stack stack-lg ${styles.page}`}>
      <PageHeader
        title="Models"
        lead="Exact spend per model, straight from the usage numbers on every billed request — no estimation anywhere on this page."
      />

      {models.isError ? (
        <QueryError error={models.error} what="the model analytics" onRetry={() => void models.refetch()} />
      ) : null}

      {models.isPending ? (
        <div className="stack" aria-busy="true">
          <Skeleton height={96} label="Loading model analytics" />
          <Skeleton height={240} />
        </div>
      ) : null}

      {models.data ? (
        rows.length === 0 ? (
          <EmptyState title="No model billed in this range" description="Widen the date range." icon="model" />
        ) : (
          <>
            <div className="grid-kpis">
              <Kpi label="Spend" size="lg" value={<Money usd={total} currency={currency} display />} sub={plural(rows.length, 'model')} />
              <Kpi
                label="Leading model"
                value={leader ? <span className="num-display">{formatPercent(total > 0 ? leader.cost.total / total : 0)}</span> : '—'}
                sub={leader?.label}
              />
              <Kpi label="Requests" value={<span className="num-display">{formatCount(requests)}</span>} />
              <Kpi
                label="Output tokens"
                value={<Tokens value={outputTokens} />}
                sub={<Tokens value={contextTokens} unit="ctx tok" />}
              />
            </div>

            {/* The chart carries its own heading, so the section head does not stack a second
                title row above the frame's legend and Chart/Table toggle. */}
            <section aria-labelledby="daily-models-heading" className="stack">
              <DailyModelChart
                daily={models.data.daily}
                models={rows}
                currency={currency}
                headingId="daily-models-heading"
              />
            </section>

            <Section title="Every model in range">
              <LedgerTable
                columns={columns}
                rows={rows}
                rowKey={(row) => row.model}
                caption="Exact cost per model in the selected range"
                defaultSort={{ columnId: 'total', direction: 'desc' }}
                footer={[
                  plural(rows.length, 'model'),
                  formatCount(requests),
                  null,
                  null,
                  null,
                  <Money key="output" usd={rows.reduce((sum, row) => sum + row.cost.output, 0)} currency={currency} />,
                  <Money key="write" usd={rows.reduce((sum, row) => sum + row.cost.cacheWrite, 0)} currency={currency} />,
                  <Money key="read" usd={rows.reduce((sum, row) => sum + row.cost.cacheRead, 0)} currency={currency} />,
                  null,
                  formatPercent(total > 0 ? 1 : 0),
                  <Money key="total" usd={total} currency={currency} />,
                ]}
              />
            </Section>

            <Section title="Speed tier" note="fast mode is billed at double rates on the models that offer it">
              <div className={styles.speedGrid}>
                <div className={styles.panel}>
                  <Receipt rows={speedRows} />
                </div>
              </div>
            </Section>
          </>
        )
      ) : null}
    </div>
  );
}

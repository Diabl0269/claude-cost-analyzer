import { useMemo } from 'react';
import { Duration, LedgerTable, Money, Tokens, type LedgerColumn } from '@/components';
import type { CurrencyDisplay } from '@/lib/format';
import { EM_DASH, formatCount, formatPercent } from '@/lib/format';

export type CompareKind = 'money' | 'count' | 'tokens' | 'duration' | 'percent';

export interface CompareRow {
  id: string;
  label: string;
  note?: string;
  a: number | null;
  b: number | null;
  kind: CompareKind;
  /** for spend rows, less is better; for counts neither direction is good or bad */
  emphasis?: 'total' | 'muted';
}

function render(value: number | null, kind: CompareKind, currency: CurrencyDisplay, display = false) {
  if (value === null) return <span className="muted-2">{EM_DASH}</span>;
  switch (kind) {
    case 'money':
      return <Money usd={value} currency={currency} display={display} />;
    case 'tokens':
      return <Tokens value={value} />;
    case 'duration':
      return <Duration ms={value} />;
    case 'percent':
      return formatPercent(value);
    case 'count':
      return formatCount(value);
  }
}

function renderDelta(row: CompareRow, currency: CurrencyDisplay) {
  if (row.a === null || row.b === null) return <span className="muted-2">{EM_DASH}</span>;
  const delta = row.b - row.a;
  if (delta === 0) return <span className="muted-2">{EM_DASH}</span>;
  if (row.kind === 'money') return <Money usd={delta} currency={currency} delta tone="auto" />;
  const sign = delta > 0 ? '+' : '−';
  const magnitude = Math.abs(delta);
  if (row.kind === 'duration') return <span>{sign}<Duration ms={magnitude} /></span>;
  if (row.kind === 'tokens') return <span>{sign}<Tokens value={magnitude} /></span>;
  if (row.kind === 'percent') return <span>{sign}{formatPercent(magnitude)}</span>;
  return <span>{sign}{formatCount(magnitude)}</span>;
}

export interface CompareTableProps {
  rows: CompareRow[];
  caption: string;
  labelA: string;
  labelB: string;
  currency: CurrencyDisplay;
}

/** Metric · A · B · (B − A). The delta column is the point of the page. */
export function CompareTable({ rows, caption, labelA, labelB, currency }: CompareTableProps) {
  const columns = useMemo<LedgerColumn<CompareRow>[]>(
    () => [
      {
        id: 'label',
        header: 'Metric',
        width: '34%',
        cell: (row) => (
          <span className={row.emphasis === 'muted' ? 'muted' : undefined} style={row.emphasis === 'total' ? { fontWeight: 600 } : undefined}>
            {row.label}
            {row.note ? <span className="muted-2 ui-xs"> {row.note}</span> : null}
          </span>
        ),
      },
      { id: 'a', header: labelA, numeric: true, width: '22%', cell: (row) => render(row.a, row.kind, currency, row.emphasis === 'total') },
      { id: 'b', header: labelB, numeric: true, width: '22%', cell: (row) => render(row.b, row.kind, currency, row.emphasis === 'total') },
      { id: 'delta', header: 'B − A', numeric: true, width: '22%', cell: (row) => renderDelta(row, currency) },
    ],
    [labelA, labelB, currency],
  );

  return <LedgerTable columns={columns} rows={rows} rowKey={(row) => row.id} caption={caption} dense />;
}

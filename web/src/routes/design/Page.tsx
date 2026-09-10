import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Callout,
  ContextStrip,
  CostWaterfall,
  DateRange,
  Dialog,
  Duration,
  EmptyState,
  EstimateBadge,
  HeatStrip,
  Icon,
  IconButton,
  ICON_NAMES,
  Kpi,
  LedgerTable,
  ModelChip,
  Money,
  NumberField,
  PlanGauge,
  Popover,
  Receipt,
  RelativeTime,
  SegmentedControl,
  Select,
  Skeleton,
  Sparkline,
  Switch,
  Tabs,
  Tokens,
  TokenBar,
  Tooltip,
  TreeNav,
  useToast,
  type LedgerColumn,
} from '@/components';
import { IndexStatusPill } from '@/app/shell/IndexStatusPill';
import { contrastRatio } from '@/design/contrast';
import { useKeyboard } from '@/lib/keyboard';
import { useDateRange } from '@/lib/range';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { formatDate, formatPercent } from '@/lib/format';
import {
  MANY_SESSIONS,
  SAMPLE_CONTEXT,
  SAMPLE_DAYS,
  SAMPLE_INDEXED_AT,
  SAMPLE_INDEX_STARTED_AT,
  SAMPLE_PROJECT_TREE,
  SAMPLE_SESSIONS,
  SAMPLE_SPARK,
  SAMPLE_TOKENS,
  SAMPLE_TOOLS,
  SAMPLE_WATERFALL,
  type SampleSession,
  type SampleTool,
} from './sample';
import styles from './Page.module.css';

const SECTIONS = [
  ['tokens', 'Colour & type'],
  ['values', 'Values'],
  ['controls', 'Controls'],
  ['feedback', 'Feedback'],
  ['ledger', 'Ledger table'],
  ['receipts', 'Receipts & KPIs'],
  ['charts', 'Charts'],
  ['navigation', 'Navigation'],
  ['shell', 'Shell'],
  ['icons', 'Icons'],
] as const;

const PALETTE_TEXT = ['--ink', '--ink-2', '--ink-3', '--cost', '--save', '--warn', '--info'];
const PALETTE_MODELS = ['--m-opus', '--m-sonnet', '--m-haiku', '--m-fable', '--m-mythos', '--m-other'];
const PALETTE_TOKENS = ['--t-output', '--t-input', '--t-cache-write', '--t-cache-read'];

function useComputedTokens(names: readonly string[], dependency: string): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  // `names` is spread into a new array by the caller on every render, so the joined
  // string — not the array identity — is the dependency.
  const key = names.join(',');
  useEffect(() => {
    const style = window.getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const name of [...key.split(','), '--paper', '--paper-2', '--paper-3']) {
      next[name] = style.getPropertyValue(name).trim();
    }
    setValues(next);
    // `dependency` is the resolved theme: recompute whenever the palette flips.
  }, [key, dependency]);
  return values;
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section} id={id} aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHead}>
        <h2 id={`${id}-heading`}>{title}</h2>
        {note ? <p className={styles.sectionNote}>{note}</p> : null}
      </div>
      <div className="stack">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowBody}>{children}</div>
    </div>
  );
}

/** The component gallery. Not linked from the nav — open `/design` directly. */
export default function DesignPage() {
  const { theme, setTheme, resolved } = useTheme();
  const { toast } = useToast();
  const { setPaletteOpen, setHelpOpen } = useKeyboard();
  const range = useDateRange();
  const swatches = useComputedTokens([...PALETTE_TEXT, ...PALETTE_MODELS, ...PALETTE_TOKENS], resolved);

  const [switchOn, setSwitchOn] = useState(true);
  const [segment, setSegment] = useState('cost');
  const [tab, setTab] = useState('summary');
  const [price, setPrice] = useState<number | null>(5);
  const [model, setModel] = useState('opus-5');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(SAMPLE_WATERFALL[6]?.seq ?? null);
  const [brush, setBrush] = useState<string>('none');
  const [selectedProject, setSelectedProject] = useState<string | null>('payments-gateway');
  const [selectedRow, setSelectedRow] = useState<string | null>(SAMPLE_SESSIONS[0]?.id ?? null);

  const sessionColumns = useMemo<LedgerColumn<SampleSession>[]>(
    () => [
      {
        id: 'title',
        header: 'Session',
        width: '38%',
        sortValue: (row) => row.title,
        cell: (row) => (
          <span className={styles.titleCell}>
            {row.pinned ? <Icon name="pin" size={12} className={styles.pin} /> : null}
            <span className="truncate">{row.title}</span>
          </span>
        ),
      },
      { id: 'project', header: 'Project', sortValue: (row) => row.project, secondary: true, cell: (row) => row.project },
      {
        id: 'started',
        header: 'Started',
        sortValue: (row) => row.startedAt,
        secondary: true,
        cell: (row) => <RelativeTime value={row.startedAt} />,
      },
      { id: 'duration', header: 'Duration', numeric: true, sortValue: (row) => row.durationMs, cell: (row) => <Duration ms={row.durationMs} /> },
      {
        id: 'models',
        header: 'Models',
        cell: (row) => (
          <span className="cluster" style={{ ['--gap' as string]: '4px' }}>
            {row.models.map((id) => (
              <ModelChip key={id} model={id} glyphOnly />
            ))}
          </span>
        ),
      },
      { id: 'prompts', header: 'Prompts', numeric: true, sortValue: (row) => row.prompts, cell: (row) => row.prompts },
      { id: 'requests', header: 'Requests', numeric: true, sortValue: (row) => row.requests, cell: (row) => row.requests },
      {
        id: 'delta',
        header: 'Δ vs CC',
        numeric: true,
        secondary: true,
        sortValue: (row) => row.reportedDelta,
        headerTitle: 'Difference against the tally Claude Code recorded for the session',
        cell: (row) => (
          <span className={Math.abs(row.reportedDelta) > 0.05 ? styles.deltaWarn : styles.deltaOk}>
            {formatPercent(row.reportedDelta)}
          </span>
        ),
      },
      { id: 'cost', header: 'Cost', numeric: true, sortValue: (row) => row.cost, cell: (row) => <Money usd={row.cost} /> },
    ],
    [],
  );

  const toolColumns = useMemo<LedgerColumn<SampleTool>[]>(
    () => [
      { id: 'name', header: 'Tool', sortValue: (row) => row.name, cell: (row) => <span className="truncate">{row.name}</span> },
      { id: 'calls', header: 'Calls', numeric: true, sortValue: (row) => row.calls, cell: (row) => row.calls },
      {
        id: 'errors',
        header: 'Errors',
        numeric: true,
        sortValue: (row) => row.errors,
        cell: (row) => (row.errors > 0 ? <span className={styles.deltaWarn}>{row.errors}</span> : row.errors),
      },
      { id: 'gen', header: 'Generate', numeric: true, sortValue: (row) => row.genCost, cell: (row) => <Money usd={row.genCost} /> },
      { id: 'ingest', header: 'Ingest', numeric: true, sortValue: (row) => row.ingestCost, cell: (row) => <Money usd={row.ingestCost} /> },
      { id: 'carry', header: 'Carry', numeric: true, sortValue: (row) => row.carryCost, cell: (row) => <Money usd={row.carryCost} /> },
      {
        id: 'child',
        header: 'Delegated',
        numeric: true,
        sortValue: (row) => row.childCost,
        cell: (row) => (row.childCost > 0 ? <Money usd={row.childCost} /> : <span className="muted-2">—</span>),
      },
      {
        id: 'total',
        header: 'Own total',
        numeric: true,
        sortValue: (row) => row.genCost + row.ingestCost + row.carryCost,
        cell: (row) => <Money usd={row.genCost + row.ingestCost + row.carryCost} />,
      },
    ],
    [],
  );

  const toolsTotal = SAMPLE_TOOLS.reduce((sum, tool) => sum + tool.genCost + tool.ingestCost + tool.carryCost, 0);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Design system</p>
          <h1>The Ledger</h1>
          <p className={styles.lede}>
            Every component with realistic (invented) data. Switch the theme to check both palettes; every pair below is
            measured with the same contrast function the tests use.
          </p>
        </div>
        <div className="cluster">
          <SegmentedControl<ThemeChoice>
            label="Theme"
            value={theme}
            onChange={setTheme}
            size="md"
            options={[
              { value: 'system', label: 'System', icon: 'settings' },
              { value: 'paper', label: 'Paper', icon: 'sun' },
              { value: 'slate', label: 'Slate', icon: 'moon' },
            ]}
          />
        </div>
      </header>

      <nav className={styles.toc} aria-label="Gallery sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={styles.tocLink}>
            {label}
          </a>
        ))}
      </nav>

      <Section id="tokens" title="Colour & type" note={`Measured against --paper in the ${resolved} palette.`}>
        <div className={styles.swatchGrid}>
          {[...PALETTE_TEXT, ...PALETTE_MODELS, ...PALETTE_TOKENS].map((name) => {
            const value = swatches[name] ?? '';
            const background = swatches['--paper'] ?? '#ffffff';
            let ratio = 0;
            try {
              ratio = value ? contrastRatio(value, background) : 0;
            } catch {
              ratio = 0;
            }
            const isGraphic = PALETTE_TOKENS.includes(name);
            const passes = ratio >= (isGraphic ? 3 : 4.5);
            return (
              <div key={name} className={styles.swatch}>
                <span className={styles.swatchChip} style={{ background: `var(${name})` }} />
                <span className={styles.swatchName}>{name}</span>
                <span className={['num', styles.swatchValue].join(' ')}>{value || '—'}</span>
                <span className={['num', passes ? styles.pass : styles.fail].join(' ')}>
                  {ratio ? `${ratio.toFixed(2)}:1` : '—'}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.typeSpecimen}>
          <p className="display-lg">$1,284.06</p>
          <p className="display">Fraunces sets the display numerals</p>
          <p>Geist carries the interface text at 14px with a 1.45 line height.</p>
          <p className="num">0123456789 · tabular, slashed zero · $0.0042 · 12.4K tok</p>
          <p className="eyebrow">Eyebrow label</p>
        </div>
      </Section>

      <Section id="values" title="Values" note="Every number is tabular; the title attribute always carries full precision.">
        <Row label="Money">
          <Money usd={143.5062} />
          <Money usd={0.0042} />
          <Money usd={0.00002} />
          <Money usd={-18.4} delta tone="save" />
          <Money usd={1284.06} display />
        </Row>
        <Row label="Tokens">
          <Tokens value={843} />
          <Tokens value={12_482} />
          <Tokens value={8_942_006} unit="tok" />
        </Row>
        <Row label="Duration">
          <Duration ms={620} />
          <Duration ms={4200} />
          <Duration ms={750_000} />
          <Duration ms={15_120_000} />
        </Row>
        <Row label="Relative time">
          <RelativeTime value={new Date(Date.now() - 4 * 60_000)} />
          <RelativeTime value={new Date(Date.now() - 30 * 3600_000)} />
          <RelativeTime value="2026-08-11T10:00:00Z" />
        </Row>
        <Row label="Model chips">
          <ModelChip model="claude-opus-5[1m]" />
          <ModelChip model="claude-sonnet-5" />
          <ModelChip model="claude-haiku-4-5-20251001" />
          <ModelChip model="claude-fable-5-1" />
          <ModelChip model="claude-mythos-5-1" />
          <ModelChip model="gpt-unknown" />
        </Row>
        <Row label="Estimates">
          <EstimateBadge method="delta" />
          <EstimateBadge method="heuristic" />
          <EstimateBadge method="image" />
        </Row>
        <Row label="Skeletons">
          <Skeleton width={120} height={12} />
          <Skeleton width={200} lines={3} height={10} />
        </Row>
      </Section>

      <Section id="controls" title="Controls">
        <Row label="Buttons">
          <Button variant="primary">Re-index</Button>
          <Button variant="secondary" iconStart="download">
            Export CSV
          </Button>
          <Button variant="ghost" iconStart="filter">
            Filters
          </Button>
          <Button variant="danger" iconStart="warning">
            Rebuild index
          </Button>
          <Button variant="secondary" loading>
            Indexing
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="Icon buttons">
          <IconButton icon="pin" label="Pin session" />
          <IconButton icon="copy" label="Copy as Markdown" variant="outline" />
          <IconButton icon="external" label="Open transcript" />
          <IconButton icon="chart" label="Chart view" active />
        </Row>
        <Row label="Segmented">
          <SegmentedControl
            label="Sort by"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'cost', label: 'Cost' },
              { value: 'duration', label: 'Duration' },
            ]}
          />
        </Row>
        <Row label="Switch">
          <Switch checked={switchOn} onChange={setSwitchOn} label="Hide scratch projects" description="Sessions under /tmp and /private/var/folders" />
        </Row>
        <Row label="Fields">
          <NumberField label="Input $ / MTok" value={price} onChange={setPrice} step={0.25} min={0} prefix="$" suffix="/MTok" width={190} />
          <Select
            label="What-if model"
            value={model}
            onChange={setModel}
            options={[
              { value: 'opus-5', label: 'Claude Opus 5' },
              { value: 'sonnet-5', label: 'Claude Sonnet 5' },
              { value: 'haiku-4.5', label: 'Claude Haiku 4.5' },
              { value: 'fable-5.1', label: 'Claude Fable 5.1' },
            ]}
          />
        </Row>
        <Row label="Date range">
          <DateRange value={range.value} onPreset={range.setPreset} onBounds={range.setBounds} />
        </Row>
        <Row label="Tabs">
          <Tabs
            label="Session sections"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'summary', label: 'Summary' },
              { id: 'transcript', label: 'Transcript', count: 412 },
              { id: 'tools', label: 'Tools', count: 1238 },
              { id: 'agents', label: 'Agents', count: 34 },
              { id: 'hooks', label: 'Hooks & harness' },
            ]}
          />
        </Row>
      </Section>

      <Section id="feedback" title="Feedback & overlays">
        <Row label="Callouts">
          <div className="stack stack-sm" style={{ width: '100%' }}>
            <Callout tone="info" title="Estimated attribution">
              Requests are exact. Everything attributed to a tool call, hook or injection is an estimate — see Methodology.
            </Callout>
            <Callout tone="warn" title="Unpriced model">
              <code>claude-opus-6</code> has no price in the table. Its requests are counted but cost $0.
            </Callout>
            <Callout tone="save" title="Possible saving">
              Moving the 34 Agent calls in this session from Opus 5 to Sonnet 5 would have cost $12.40 instead of $41.28.
            </Callout>
          </div>
        </Row>
        <Row label="Overlays">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => setPaletteOpen(true)} iconStart="search">
            Command palette
          </Button>
          <Button variant="secondary" onClick={() => setHelpOpen(true)}>
            Shortcuts (?)
          </Button>
          <Popover
            label="Column options"
            trigger={(props) => (
              <button type="button" className={styles.popoverTrigger} {...props}>
                <Icon name="filter" size={14} /> Columns
              </button>
            )}
          >
            <p className="eyebrow">Columns</p>
            <div className="stack stack-sm" style={{ marginTop: 'var(--s2)' }}>
              <Switch checked onChange={() => undefined} label="Project" />
              <Switch checked={false} onChange={() => undefined} label="Git branch" />
              <Switch checked onChange={() => undefined} label="Δ vs Claude Code" />
            </div>
          </Popover>
          <Tooltip content="Cache reads are billed at a tenth of the input price — this is why long sessions stay affordable.">
            <button type="button" className={styles.popoverTrigger}>
              <Icon name="info" size={14} /> Hover or focus me
            </button>
          </Tooltip>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: 'Session receipt copied',
                description: 'Markdown for “Refactor billing webhooks” is on the clipboard.',
                tone: 'save',
              })
            }
          >
            Fire a toast
          </Button>
        </Row>
        <Row label="Empty state">
          <div style={{ width: '100%' }}>
            <EmptyState
              title="No sessions in this range"
              icon="sessions"
              description="Widen the date range, or clear the project filter in the left rail."
              action={<Button variant="secondary" onClick={() => range.setPreset('all')}>Show all time</Button>}
            />
          </div>
        </Row>
      </Section>

      <Section id="ledger" title="Ledger table" note="Sortable, keyboard navigable (arrows, Home/End, Enter), sticky header, virtualized past 200 rows.">
        <LedgerTable
          columns={sessionColumns}
          rows={SAMPLE_SESSIONS}
          rowKey={(row) => row.id}
          caption="Sessions in the selected range"
          defaultSort={{ columnId: 'cost', direction: 'desc' }}
          selectedKey={selectedRow}
          onActivateRow={(row) => setSelectedRow(row.id)}
          footer={[
            <span key="t">{SAMPLE_SESSIONS.length} sessions</span>,
            '',
            '',
            '',
            '',
            <span key="p" className="num">
              {SAMPLE_SESSIONS.reduce((sum, row) => sum + row.prompts, 0)}
            </span>,
            <span key="r" className="num">
              {SAMPLE_SESSIONS.reduce((sum, row) => sum + row.requests, 0)}
            </span>,
            '',
            <Money key="c" usd={SAMPLE_SESSIONS.reduce((sum, row) => sum + row.cost, 0)} />,
          ]}
        />

        <div className={styles.split}>
          <div className="stack stack-sm">
            <p className="eyebrow">Loading</p>
            <LedgerTable columns={toolColumns.slice(0, 4)} rows={[]} rowKey={() => ''} caption="Loading tools" loading skeletonRows={4} dense />
          </div>
          <div className="stack stack-sm">
            <p className="eyebrow">Empty</p>
            <LedgerTable
              columns={toolColumns.slice(0, 4)}
              rows={[]}
              rowKey={() => ''}
              caption="No tools"
              dense
              empty={<EmptyState inline title="No tool calls" description="This session only exchanged prompts." icon="tools" />}
            />
          </div>
        </div>

        <div className="stack stack-sm">
          <p className="eyebrow">Virtualized · {MANY_SESSIONS.length} rows</p>
          <LedgerTable
            columns={sessionColumns.slice(0, 5)}
            rows={MANY_SESSIONS}
            rowKey={(row) => row.id}
            caption="Every session ever indexed"
            maxHeight={320}
            dense
          />
        </div>
      </Section>

      <Section id="receipts" title="Receipts & KPIs">
        <div className="grid-kpis">
          <Kpi label="Spend" value={<Money usd={324.6} display />} delta={{ fraction: 0.18, good: 'down', label: 'vs previous 30 days' }} hint="Sum of every billed request at list prices." />
          <Kpi label="Requests" value="1,187" delta={{ fraction: 0.22, label: 'vs previous 30 days' }} sub="41 sessions" />
          <Kpi label="Cache hit ratio" value="94.2%" delta={{ fraction: 0.03, good: 'up', label: 'better' }} />
          <Kpi label="Cost per prompt" value={<Money usd={1.4821} display />} delta={{ fraction: -0.09, good: 'down', label: 'cheaper' }} />
        </div>

        <div className={styles.split}>
          <div className="panel panel-pad">
            <Receipt
              caption="Refactor billing webhooks"
              rows={[
                { id: 'output', label: 'Output tokens', value: <Money usd={41.2044} /> },
                { id: 'input', label: 'Input tokens', value: <Money usd={2.9013} /> },
                { id: 'w5', label: 'Cache writes (5m)', value: <Money usd={28.4471} />, indent: 1 },
                { id: 'w1', label: 'Cache writes (1h)', value: <Money usd={44.0192} />, indent: 1 },
                { id: 'read', label: 'Cache reads', value: <Money usd={26.9342} /> },
                { id: 'web', label: 'Web search', value: <Money usd={0.02} />, emphasis: 'muted' },
                { id: 'sub', label: 'Main transcript', value: <Money usd={102.2262} />, emphasis: 'subtotal' },
                { id: 'agents', label: 'Subagents (34)', value: <Money usd={41.28} /> },
                { id: 'total', label: 'Session total', value: <Money usd={143.5062} />, emphasis: 'total' },
              ]}
              footer={
                <span>
                  Claude Code recorded $143.44 for this session — a 0.04% difference. <EstimateBadge method="delta" />
                </span>
              }
            />
          </div>
          <div className="panel panel-pad stack">
            <p className="eyebrow">Token mix</p>
            <TokenBar tokens={SAMPLE_TOKENS} />
            <p className="eyebrow" style={{ marginTop: 'var(--s3)' }}>
              Trend
            </p>
            <div className="cluster">
              <Sparkline values={SAMPLE_SPARK} ariaLabel="Daily spend rose from $3.20 to $21.90 over twelve days" width={160} height={36} />
              <Money usd={21.9} />
              <span className="muted-2 ui-xs">per day</span>
            </div>
          </div>
        </div>
      </Section>

      <Section id="charts" title="Charts" note="Every chart has a text summary, keyboard-focusable marks and a table view.">
        <CostWaterfall
          data={SAMPLE_WATERFALL}
          selectedSeq={selectedSeq}
          onSelect={(datum) => setSelectedSeq(datum.seq)}
          onBrush={(selection) => setBrush(selection ? `#${selection.fromSeq}–#${selection.toSeq}` : 'none')}
          title="Cost per request · Refactor billing webhooks"
        />
        <p className="ui-xs muted-2">
          Selected request: <span className="num">{selectedSeq ?? '—'}</span> · brushed range: <span className="num">{brush}</span>
        </p>

        <div className="stack stack-sm">
          <p className="eyebrow">Heat strip · 30 days</p>
          <HeatStrip days={SAMPLE_DAYS} selectedDate={SAMPLE_DAYS[21]?.date ?? null} />
        </div>

        <div className="stack stack-sm">
          <p className="eyebrow">Context at request #148</p>
          <ContextStrip segments={SAMPLE_CONTEXT} />
        </div>

        <div className={styles.split}>
          <PlanGauge planLabel="Max 20×" planUsd={200} apiUsd={324.6} forecastUsd={412.8} month={formatDate('2026-09-01', 'month')} />
          <div className="stack stack-sm">
            <p className="eyebrow">Spend by model</p>
            <TokenBar label="Opus 5" tokens={{ ...SAMPLE_TOKENS, output: 210_000 }} showLegend={false} />
            <TokenBar label="Sonnet 5" tokens={{ ...SAMPLE_TOKENS, output: 62_000, cacheRead: 2_100_000 }} showLegend={false} />
            <TokenBar label="Haiku 4.5" tokens={{ ...SAMPLE_TOKENS, output: 18_000, cacheRead: 340_000 }} showLegend={false} />
          </div>
        </div>

        <div className="stack stack-sm">
          <p className="eyebrow">Tools by attributed cost</p>
          <LedgerTable
            columns={toolColumns}
            rows={SAMPLE_TOOLS}
            rowKey={(row) => row.name}
            caption="Tools by attributed cost"
            defaultSort={{ columnId: 'total', direction: 'desc' }}
            footer={['Total', '', '', '', '', '', '', <Money key="t" usd={toolsTotal} />]}
          />
        </div>
      </Section>

      <Section id="navigation" title="Navigation">
        <div className={styles.split}>
          <div className="panel panel-pad">
            <p className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>
              Project tree
            </p>
            <TreeNav
              nodes={SAMPLE_PROJECT_TREE}
              label="Projects"
              selectedId={selectedProject}
              defaultExpandedIds={['platform-infra']}
              onSelect={(node) => setSelectedProject(node.id)}
            />
          </div>
          <div className="panel panel-pad stack stack-sm">
            <p className="eyebrow">Keyboard</p>
            <p className="ui-sm muted">
              <kbd>?</kbd> shortcuts · <kbd>/</kbd> search · <kbd>G</kbd> then <kbd>S</kbd> sessions · <kbd>J</kbd>/<kbd>K</kbd> rows
            </p>
            <p className="ui-xs muted-2">
              Shortcuts are ignored while a text field has focus. The palette registers itself as ⌘K / Ctrl-K.
            </p>
          </div>
        </div>
      </Section>

      <Section id="shell" title="Shell" note="The top-bar index pill in every state it can reach.">
        <Row label="Index status">
          <IndexStatusPill
            progress={{
              phase: 'parse',
              filesDone: 214,
              filesTotal: 515,
              sessionsDone: 180,
              sessionsTotal: 515,
              currentProject: 'payments-gateway',
              startedAt: SAMPLE_INDEX_STARTED_AT,
            }}
            lastIndexedAt={null}
            connected
          />
          <IndexStatusPill progress={null} lastIndexedAt={SAMPLE_INDEXED_AT} connected sessionCount={515} />
          <IndexStatusPill progress={null} lastIndexedAt={null} connected={false} />
          <IndexStatusPill progress={null} lastIndexedAt={SAMPLE_INDEXED_AT} connected error="EACCES reading a transcript root" />
        </Row>
      </Section>

      <Section id="icons" title="Icons" note="16px, hand-drawn strokes, currentColor.">
        <div className={styles.iconGrid}>
          {ICON_NAMES.map((name) => (
            <div key={name} className={styles.iconCell}>
              <Icon name={name} size={20} />
              <span className={styles.iconName}>{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Rebuild the index?"
        description="This deletes the SQLite cache and re-reads every transcript. Nothing in ~/.claude is modified."
        alert
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDialogOpen(false);
                toast({ title: 'Full re-index started', tone: 'info' });
              }}
            >
              Rebuild
            </Button>
          </>
        }
      >
        <p className="ui-sm muted">
          The current index holds 515 sessions and 21,696 assistant lines. A full rebuild took about 40 seconds last time.
        </p>
      </Dialog>
    </div>
  );
}

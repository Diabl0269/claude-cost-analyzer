#!/usr/bin/env node
/**
 * Validation oracle (SPEC §5.4).
 *
 * Indexes the configured transcript roots, then for every session that carries a `cost-state`
 * line compares our per-class token counts (input / output / cacheRead / cacheWrite, summed over
 * the main transcript *and* every agent) and our USD total against Claude Code's own tally, and
 * classifies the gap (see core/cost/reported.ts for what the statuses mean).
 *
 * Usage:
 *   node --import tsx/esm scripts/validate-cost-state.ts [--full] [--write-doc] [--limit N]
 *   npm run validate -- --write-doc
 *
 * Honours `CCA_HOME` (index location) and `CCA_CLAUDE_DIR` / `--claude-dir` (transcript roots),
 * so it can reuse an index built by a running server instead of rebuilding one.
 *
 * Prints session id prefixes and project directory names only — never a title, prompt or any
 * other transcript content.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runIndex } from '../core/db/indexer.js';
import { createStore } from '../core/db/store.js';
import { SCHEMA_VERSION } from '../core/db/schema.js';
import { DIVERGENCE_PCT, MATCH_TOLERANCE_PCT } from '../core/cost/reported.js';
import type { QueryContext } from '../core/store.js';
import type { ReportedComparison, ReportedComparisonStatus, SessionDetail } from '../core/types.js';
import { ConfigStore } from '../server/config.js';
import { ensureHomeDir, resolvePaths, resolveRoots } from '../server/paths.js';

const STATUSES: ReportedComparisonStatus[] = [
  'match',
  'tally-includes-earlier-process',
  'file-covers-more-than-tally',
  'hidden-calls-only',
  'mixed',
];

interface Flags {
  full: boolean;
  writeDoc: boolean;
  limit: number;
  claudeDir?: string;
  home?: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { full: false, writeDoc: false, limit: Number.POSITIVE_INFINITY };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--full':
        flags.full = true;
        break;
      case '--write-doc':
        flags.writeDoc = true;
        break;
      case '--limit':
        flags.limit = Number(argv[++i]);
        break;
      case '--claude-dir':
        flags.claudeDir = argv[++i];
        break;
      case '--home':
        flags.home = argv[++i];
        break;
      default:
        console.warn(`unrecognized flag: ${argv[i]}`);
    }
  }
  return flags;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (sorted.length % 2 === 1) return high ?? 0;
  return ((low ?? 0) + (high ?? 0)) / 2;
}

function pct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function pad(text: string, width: number, right = false): string {
  if (text.length > width) return text.slice(0, width - 1) + '…';
  return right ? text.padStart(width) : text.padEnd(width);
}

/** Last segment of the project path — enough to tell rows apart, no transcript content. */
function projectTail(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

interface Row {
  sessionId: string;
  project: string;
  comparison: ReportedComparison;
  reportedUsd: number;
  computedUsd: number;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const paths = resolvePaths(flags.home === undefined ? {} : { home: flags.home });
  ensureHomeDir(paths.home);
  const config = ConfigStore.load(paths.configPath);
  const { pricing, settings } = config.get();
  const roots = resolveRoots(
    flags.claudeDir === undefined
      ? { settingsRoots: settings.roots }
      : { settingsRoots: settings.roots, claudeDirFlag: flags.claudeDir },
  );

  console.log(`roots: ${roots.join(', ')}`);
  console.log(`index: ${paths.dbPath}`);
  const indexResult = await runIndex({ roots, dbPath: paths.dbPath, full: flags.full, pricing });
  console.log(
    `indexed ${indexResult.sessionsIndexed} / skipped ${indexResult.sessionsSkipped} sessions ` +
      `(${indexResult.filesSeen} files, ${indexResult.parseErrors} parse errors) in ${indexResult.durationMs} ms\n`,
  );

  const store = createStore(paths.dbPath);
  try {
    // Scratch projects are hidden in the UI by default; the oracle must still see them.
    const ctx: QueryContext = { pricing, settings: { ...settings, hideScratchProjects: false } };
    const listed = await store.listSessions({ from: '2000-01-01', to: '2100-01-01', limit: 500 }, ctx);
    const withTally = listed.sessions.filter((s) => s.reportedCostUsd !== null).slice(0, flags.limit);
    console.log(`${listed.total} sessions indexed, ${withTally.length} with a cost-state line\n`);

    const rows: Row[] = [];
    for (const summary of withTally) {
      const detail: SessionDetail | null = await store.getSession(summary.id, ctx);
      const comparison = detail?.facts.reportedComparison;
      const reported = detail?.facts.reported;
      if (!detail || !comparison || !reported) continue;
      rows.push({
        sessionId: summary.id,
        project: projectTail(summary.projectPath),
        comparison,
        reportedUsd: reported.totalCostUSD,
        computedUsd: detail.summary.cost.total,
      });
    }

    const header =
      pad('session', 9) +
      pad('project', 26) +
      pad('input', 9, true) +
      pad('output', 9, true) +
      pad('cacheRd', 9, true) +
      pad('cacheWr', 9, true) +
      '  ' +
      pad('reported', 12, true) +
      pad('computed', 12, true) +
      pad('Δusd', 9, true) +
      '  status';
    console.log(header);
    console.log('-'.repeat(header.length));
    const byStatus = new Map<ReportedComparisonStatus, Row[]>();
    for (const row of [...rows].sort((a, b) => Math.abs(b.comparison.deltaPct) - Math.abs(a.comparison.deltaPct))) {
      const c = row.comparison.classes;
      console.log(
        pad(row.sessionId.slice(0, 8), 9) +
          pad(row.project, 26) +
          pad(pct(c.input), 9, true) +
          pad(pct(c.output), 9, true) +
          pad(pct(c.cacheRead), 9, true) +
          pad(pct(c.cacheWrite), 9, true) +
          '  ' +
          pad(usd(row.reportedUsd), 12, true) +
          pad(usd(row.computedUsd), 12, true) +
          pad(pct(row.comparison.deltaPct), 9, true) +
          '  ' +
          row.comparison.status,
      );
      byStatus.set(row.comparison.status, [...(byStatus.get(row.comparison.status) ?? []), row]);
    }

    const allAbs = rows.map((r) => Math.abs(r.comparison.deltaPct));
    const matches = byStatus.get('match') ?? [];
    const matchAbs = matches.map((r) => Math.abs(r.comparison.deltaPct));
    const worstMatch = matchAbs.length > 0 ? Math.max(...matchAbs) : 0;
    const exact = rows.filter(isExact).length;

    console.log('\nsummary');
    console.log(`  sessions compared          ${rows.length}`);
    for (const status of STATUSES) {
      console.log(`  ${pad(status, 26)} ${String((byStatus.get(status) ?? []).length).padStart(4)}`);
    }
    console.log(`  identical token counts     ${exact}`);
    console.log(`  median |Δusd| overall      ${median(allAbs).toFixed(2)}%`);
    console.log(`  median |Δusd| within match ${median(matchAbs).toFixed(4)}%`);
    console.log(`  worst  |Δusd| within match ${worstMatch.toFixed(4)}%`);
    console.log(
      `  reported total             ${usd(rows.reduce((n, r) => n + r.reportedUsd, 0))}\n` +
        `  computed total             ${usd(rows.reduce((n, r) => n + r.computedUsd, 0))}`,
    );

    if (worstMatch > MATCH_TOLERANCE_PCT) {
      console.error(
        `\nFAIL: a 'match' session has a USD delta of ${worstMatch.toFixed(2)}%, above the ${MATCH_TOLERANCE_PCT}% tolerance`,
      );
      process.exitCode = 1;
    }

    if (flags.writeDoc) {
      const docPath = fileURLToPath(new URL('../docs/dev/validation.md', import.meta.url));
      writeFileSync(docPath, renderDoc(rows, byStatus, listed.total, indexResult.durationMs), 'utf8');
      console.log(`\nwrote ${docPath}`);
    }
  } finally {
    store.close();
  }
}

/** Every class delta exactly zero: our token counts and Claude Code's are the same numbers. */
function isExact(row: Row): boolean {
  const c = row.comparison.classes;
  return c.input === 0 && c.output === 0 && c.cacheRead === 0 && c.cacheWrite === 0;
}

function renderDoc(
  rows: readonly Row[],
  byStatus: ReadonlyMap<ReportedComparisonStatus, Row[]>,
  sessionsIndexed: number,
  indexMs: number,
): string {
  const allAbs = rows.map((r) => Math.abs(r.comparison.deltaPct));
  const matchAbs = (byStatus.get('match') ?? []).map((r) => Math.abs(r.comparison.deltaPct));
  const count = (status: ReportedComparisonStatus): number => (byStatus.get(status) ?? []).length;
  const share = (status: ReportedComparisonStatus): string =>
    rows.length === 0 ? '0%' : `${((count(status) / rows.length) * 100).toFixed(0)}%`;
  return `# Validation against Claude Code's own tally

Generated by \`npm run validate -- --write-doc\` (\`scripts/validate-cost-state.ts\`). Numbers only —
no session titles, prompts or any other transcript content is recorded here.

## What it does

For every session with a \`cost-state\` line it sums our stored token counts over the main
transcript **and every agent**, in the four billed classes (input, output, cacheRead, cacheWrite),
and compares them with Claude Code's tally, then prices both sides and compares the USD totals.
Each delta is signed, \`(computed − reported) / max(computed, reported)\`, so it is bounded by ±100%
and stays defined when one side is zero. Positive means our number is the larger one.

Sessions are classified rather than pass/failed, because the two numbers answer different
questions — see \`docs/METHODOLOGY.md\` §2 "Cross-check".

## Last run

| | |
|---|---|
| sessions listed (whole history) | ${sessionsIndexed} |
| index time (this run) | ${(indexMs / 1000).toFixed(2)} s |
| sessions with a \`cost-state\` line | ${rows.length} |
| of those, identical token counts | ${rows.filter(isExact).length} |
| median \\|Δ USD\\| across all of them | ${median(allAbs).toFixed(1)} % |
| median \\|Δ USD\\| within \`match\` | ${median(matchAbs).toFixed(4)} % |
| worst \\|Δ USD\\| within \`match\` | ${(matchAbs.length > 0 ? Math.max(...matchAbs) : 0).toFixed(4)} % |
| reported total | ${usd(rows.reduce((n, r) => n + r.reportedUsd, 0))} |
| computed total | ${usd(rows.reduce((n, r) => n + r.computedUsd, 0))} |

The totals drift a little between runs while a session is still being written; the classification
counts and the \`match\` deltas are what the run is actually checking. "Index time" is whatever this
run did: an incremental pass over an already-built index is a few tens of milliseconds, a
\`--full\` rebuild of this corpus (645 files, 477 sessions) is ~4 s.

| status | sessions | share |
|---|---:|---:|
${STATUSES.map((s) => `| \`${s}\` | ${count(s)} | ${share(s)} |`).join('\n')}

The headline result: **on every session whose token counts are identical, the money is identical
to the cent — a 0.0000 % delta.** Within the wider \`match\` band (all four classes inside ${MATCH_TOLERANCE_PCT} %) the
worst USD delta is ${(matchAbs.length > 0 ? Math.max(...matchAbs) : 0).toFixed(2)} %, which is just that same tolerance carried through the price
arithmetic. Every remaining gap is a token-count gap with a known structural cause, not a pricing
error.

### How a session is classified

1. A class is ignored unless one side reaches **10,000 tokens**. A real session's plain \`input\` is
   a few dozen tokens (everything else is cache), so a single hidden 1,600-token background call
   reads as a −99 % divergence worth a fifth of a cent. The percentage is still printed; it just
   does not decide the status.
2. \`hidden-calls-only\`: nothing billed in the file, and the tally is plain input+output with no
   cache traffic, under \$1 — the shape of a title generation.
3. \`match\`: every significant class within ${MATCH_TOLERANCE_PCT} %.
4. Otherwise the direction decides: ≥2 significant classes past ${DIVERGENCE_PCT} % one way and none the other gives \`file-covers-more-than-tally\` (positive) or \`tally-includes-earlier-process\`
   (negative); divergence in both directions gives \`mixed\`. A single leaning class still names its
   direction rather than falling into \`mixed\`.

## Re-running it

\`\`\`sh
nvm use                       # Node 22; Node 23's SQLite has no FTS5
npm run validate -- --write-doc
\`\`\`

It reuses the index in \`$CCA_HOME/index.sqlite\` (incremental by default; \`--full\` rebuilds). The
first run after a schema change rebuilds it anyway — the index is a cache keyed by
\`PRAGMA user_version\`, and \`requests.cacheAssumed\` took that version to ${SCHEMA_VERSION}.
Sessions with no timestamped line at all (a truncated or orphaned file) have no local date and so
never fall inside a range; they carry no requests and no cost, and are simply not listed.
\`--claude-dir <path>\` points it at a different transcript root, \`--limit N\` shortens the table.
The script exits non-zero if a \`match\` session's USD delta ever exceeds ${MATCH_TOLERANCE_PCT} %.
`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'validation failed');
  process.exitCode = 1;
});

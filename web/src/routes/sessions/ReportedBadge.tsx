import type { ReportedComparison, ReportedComparisonStatus } from '@core/types';
import { Icon } from '@/components/Icon';
import { Tooltip } from '@/components/Tooltip';
import { formatPercent } from '@/lib/format';
import styles from './ReportedBadge.module.css';

interface StatusCopy {
  /** short label — the badge never relies on colour alone */
  label: string;
  glyph: string;
  tone: 'match' | 'info' | 'warn';
  /** one clause, for the column-header key */
  summary: string;
  /** the whole sentence, for the badge's own tooltip */
  meaning: string;
}

/**
 * Plain-language meaning of every `ReportedComparisonStatus` (SPEC §10, METHODOLOGY §2).
 * The two tallies disagree for structural reasons, not arithmetic ones, so the copy explains
 * the structure rather than apologising for a mismatch.
 */
export const REPORTED_STATUS: Record<ReportedComparisonStatus, StatusCopy> = {
  match: {
    label: 'match',
    glyph: '✓',
    tone: 'match',
    summary: 'the two tallies agree',
    meaning:
      'Every token class agrees with Claude Code’s own running tally within 5%, so the two dollar totals agree too.',
  },
  'tally-includes-earlier-process': {
    label: 'earlier',
    glyph: '↤',
    tone: 'info',
    summary: 'Claude Code counted work from before this file',
    meaning:
      'Claude Code reported more than this file contains: its tally was inherited from a parent process (a fork, a continuation or a resume), so it also counts calls that were never written here.',
  },
  'file-covers-more-than-tally': {
    label: 'resumed',
    glyph: '↦',
    tone: 'info',
    summary: 'this file covers more than Claude Code counted',
    meaning:
      'This file contains more than Claude Code reported: the tally restarted when the session was resumed while the transcript kept the whole history. Our number is the complete one.',
  },
  'hidden-calls-only': {
    label: 'hidden',
    glyph: '•',
    tone: 'info',
    summary: 'the only cost was calls that never reach the transcript',
    meaning:
      'Nothing billable was written to this file, but Claude Code still reported a small cost — background calls such as title generation, which never enter the transcript.',
  },
  mixed: {
    label: 'mixed',
    glyph: '≠',
    tone: 'warn',
    summary: 'the token classes disagree in both directions',
    meaning:
      'The token classes disagree in both directions at once. Treat the comparison as indicative; the per-request numbers on this page are still exact.',
  },
};

/** The order the header key lists them in: agreement first, then the structural reasons. */
const REPORTED_ORDER: ReportedComparisonStatus[] = [
  'match',
  'tally-includes-earlier-process',
  'file-covers-more-than-tally',
  'hidden-calls-only',
  'mixed',
];

/**
 * The `Claude Code’s tally` column header. The badges are one-word labels, which only read once
 * something says what the words mean — so the header carries the key.
 */
export function ReportedHeader() {
  return (
    <span className={styles.header}>
      Claude Code’s tally
      <Tooltip
        maxWidth={360}
        content={
          <>
            <p className={styles.keyLead}>
              How our total for a session compares with the running tally Claude Code kept for it.
            </p>
            <ul className={styles.key}>
              {REPORTED_ORDER.map((status) => (
                <li key={status}>
                  <b>{REPORTED_STATUS[status].label}</b> — {REPORTED_STATUS[status].summary}
                </li>
              ))}
              <li>
                <b>—</b> — Claude Code never reported a total for this session.
              </li>
            </ul>
          </>
        }
      >
        <button type="button" className={styles.info} aria-label="What the tally badges mean">
          <Icon name="info" size={12} />
        </button>
      </Tooltip>
    </span>
  );
}

export interface ReportedBadgeProps {
  status: ReportedComparisonStatus | undefined;
  /** the full comparison, when the page has it (session detail) */
  comparison?: ReportedComparison | undefined;
}

/** "Reported by Claude Code" agreement badge. Absent tally → an em dash, never a fake ✓. */
export function ReportedBadge({ status, comparison }: ReportedBadgeProps) {
  if (!status) {
    return (
      <span className={styles.none} title="This session has no cost-state line, so Claude Code never reported a total for it.">
        —
      </span>
    );
  }
  const copy = REPORTED_STATUS[status];
  const delta =
    comparison && Number.isFinite(comparison.deltaPct)
      ? ` We counted ${formatPercent(comparison.deltaPct / 100)} ${comparison.deltaPct >= 0 ? 'more' : 'less'} in dollars.`
      : '';
  return (
    <Tooltip content={`${copy.meaning}${delta}`} maxWidth={340}>
      <span className={styles.badge} data-tone={copy.tone}>
        <span aria-hidden="true" className={styles.glyph}>
          {copy.glyph}
        </span>
        {copy.label}
      </span>
    </Tooltip>
  );
}

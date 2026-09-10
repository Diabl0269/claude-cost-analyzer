import type { TitleSource } from '@core/types';
import { Tooltip } from '@/components/Tooltip';
import styles from './meta.module.css';

/** Where a session title came from (SPEC §4, title priority). */
export const TITLE_SOURCE: Record<TitleSource, { short: string; long: string }> = {
  'custom-title': { short: 'named', long: 'You named this session in Claude Code.' },
  'custom-title-file': { short: 'named', long: 'Taken from the session’s custom-title.json file.' },
  'ai-title': { short: 'auto', long: 'Claude Code generated this title from the conversation.' },
  'agent-name': { short: 'agent', long: 'Taken from the agent name recorded for this session.' },
  'sessions-index': { short: 'index', long: 'Taken from the project’s sessions-index.json summary.' },
  'first-prompt': { short: 'prompt', long: 'No title was recorded, so this is the cleaned first prompt.' },
  slug: { short: 'slug', long: 'No title or prompt was recorded, so this is the session slug.' },
  'session-id': { short: 'id', long: 'Nothing identifying was recorded, so this is the session id.' },
};

/**
 * Sources that say nothing worth a badge. Claude Code titles all but a handful of sessions
 * itself, so an "auto" chip on ninety-five rows out of a hundred is noise: it repeated the
 * default. The badge now marks the exceptions — a session you named, or a title the parser had
 * to improvise from a prompt, a slug or an id.
 */
const SILENT_SOURCES: ReadonlySet<TitleSource> = new Set<TitleSource>(['ai-title']);

export function TitleSourceHint({ source }: { source: TitleSource }) {
  if (SILENT_SOURCES.has(source)) return null;
  const copy = TITLE_SOURCE[source];
  return (
    <Tooltip content={copy.long}>
      <span className={styles.source}>{copy.short}</span>
    </Tooltip>
  );
}

/** `/Users/dev/projects/alpha` → `projects/alpha`; worktree paths keep their branch tail. */
export function shortProjectPath(path: string, segments = 2): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= segments) return path;
  return parts.slice(-segments).join('/');
}

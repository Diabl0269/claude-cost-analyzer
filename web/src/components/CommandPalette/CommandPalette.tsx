import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { Icon, type IconName } from '@/components/Icon';
import { fuzzyRank, highlightRuns } from '@/lib/fuzzy';
import { findShortcutKeys, formatShortcut, useOptionalKeyboard, type Shortcut } from '@/lib/keyboard';
import styles from './CommandPalette.module.css';

export interface Command {
  id: string;
  title: string;
  /** shown right of the title (a path, a project, a value) */
  subtitle?: string;
  group?: string;
  /** the key that runs this command (`g s`, `mod+k`); shown as kbd chips */
  keys?: string;
  icon?: IconName;
  /** extra words the fuzzy filter should match on */
  keywords?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  placeholder?: string;
  /** localStorage key for the recent list; set to null to disable */
  recentKey?: string | null;
  emptyLabel?: string;
}

const RECENT_LIMIT = 5;

/** A command's own binding, else the one the shortcut registry has for the same action. */
function keysOf(command: Command, registered: Shortcut[]): string | undefined {
  return command.keys ?? findShortcutKeys(registered, command.title);
}

function readRecent(key: string | null | undefined): string[] {
  if (!key) return [];
  try {
    // JSON.parse boundary: anything unexpected means "no recents".
    const raw: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** ⌘K palette: fuzzy filter over the commands the app registers, plus recents. */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder = 'Search commands, sessions and projects…',
  recentKey = 'cca.palette.recent',
  emptyLabel = 'No matching command',
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => readRecent(recentKey));
  // The right-hand slot is where a reader looks for the key that does this. A category ("Go",
  // "Range") was in that slot instead, so the palette taught nobody a single shortcut.
  const keyboard = useOptionalKeyboard();
  const registered = keyboard?.shortcuts ?? [];

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setRecent(readRecent(recentKey));
    }
  }, [open, recentKey]);

  const ordered = useMemo(() => {
    if (query.trim()) return commands;
    const rank = new Map(recent.map((id, index) => [id, index]));
    return [...commands].sort((a, b) => (rank.get(a.id) ?? RECENT_LIMIT) - (rank.get(b.id) ?? RECENT_LIMIT));
  }, [commands, query, recent]);

  const results = useMemo(
    () => fuzzyRank(ordered, query, (command) => `${command.title} ${command.subtitle ?? ''} ${command.keywords ?? ''}`),
    [ordered, query],
  );

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runCommand = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      if (recentKey) {
        const next = [command.id, ...recent.filter((id) => id !== command.id)].slice(0, RECENT_LIMIT);
        setRecent(next);
        try {
          window.localStorage.setItem(recentKey, JSON.stringify(next));
        } catch {
          /* private mode: recents just do not persist */
        }
      }
      onOpenChange(false);
      command.run();
    },
    [onOpenChange, recent, recentKey],
  );

  const showRecentLabel = !query.trim() && recent.length > 0;

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} title="Command palette" bare size="md" align="top" initialFocusRef={inputRef}>
      <div className={styles.searchRow}>
        <Icon name="search" className={styles.searchIcon} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          aria-label="Search commands"
          autoComplete="off"
          spellCheck={false}
          className={styles.input}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActive(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActive(Math.max(0, results.length - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              runCommand(results[active]?.item);
            }
          }}
        />
        <kbd className={styles.hint}>Esc</kbd>
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Commands" className={styles.list}>
        {showRecentLabel ? (
          <li className={styles.sectionLabel} role="presentation">
            Recent
          </li>
        ) : null}
        {results.map((result, index) => {
          const command = result.item;
          const runs = highlightRuns(command.title, result.indices.filter((i) => i < command.title.length));
          const keys = keysOf(command, registered);
          return (
            <li
              key={command.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              data-index={index}
              className={[styles.option, index === active ? styles.optionActive : null].filter(Boolean).join(' ')}
              onPointerMove={() => setActive(index)}
              onClick={() => runCommand(command)}
            >
              <Icon name={command.icon ?? 'chevron'} size={14} className={styles.optionIcon} />
              <span className={styles.optionTitle}>
                {runs.map((run, runIndex) =>
                  run.match ? (
                    <mark key={runIndex} className={styles.mark}>
                      {run.text}
                    </mark>
                  ) : (
                    <span key={runIndex}>{run.text}</span>
                  ),
                )}
              </span>
              {command.subtitle ? <span className={styles.optionSubtitle}>{command.subtitle}</span> : null}
              {keys ? (
                <span className={styles.optionKeys}>
                  {formatShortcut(keys).map((step, stepIndex) => (
                    <kbd key={`${command.id}-key-${stepIndex}`}>{step}</kbd>
                  ))}
                </span>
              ) : command.group ? (
                <span className={styles.optionGroup}>{command.group}</span>
              ) : null}
            </li>
          );
        })}
        {results.length === 0 ? (
          <li className={styles.empty} role="presentation">
            {emptyLabel}
          </li>
        ) : null}
      </ul>
    </Dialog>
  );
}

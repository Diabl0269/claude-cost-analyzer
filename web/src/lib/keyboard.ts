/**
 * Global keyboard layer (SPEC §10.10). Shortcuts are registered by whatever is on
 * screen; the provider owns matching, the `?` help sheet and the palette open state.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
export type ShortcutGroup = 'Navigation' | 'Search' | 'Rows' | 'View' | 'Session';

export interface Shortcut {
  id: string;
  /** `j`, `?`, `mod+k`, or a two-step sequence like `g o` */
  keys: string;
  description: string;
  group: ShortcutGroup;
  run: () => void;
  /** fire even while a text field has focus (default false) */
  allowInInput?: boolean;
  enabled?: boolean;
}

type ShortcutSource = () => Shortcut[];

interface KeyboardContextValue {
  register: (source: ShortcutSource) => () => void;
  shortcuts: Shortcut[];
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** first key of a pending sequence, e.g. `g` */
  pending: string | null;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** `mod+k` → `⌘K` on Apple, `Ctrl K` elsewhere; `g o` → `G` then `O`. */
export function formatShortcut(keys: string): string[] {
  return keys.split(' ').map((step) =>
    step
      .split('+')
      .map((part) => {
        if (part === 'mod') return IS_APPLE ? '⌘' : 'Ctrl';
        if (part === 'shift') return IS_APPLE ? '⇧' : 'Shift';
        if (part === 'alt') return IS_APPLE ? '⌥' : 'Alt';
        if (part === 'escape') return 'Esc';
        if (part === 'arrowup') return '↑';
        if (part === 'arrowdown') return '↓';
        if (part.length === 1) return part.toUpperCase();
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(IS_APPLE ? '' : ' '),
  );
}

function comboFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  const key = event.key;
  if (event.shiftKey && key.length > 1) parts.push('shift');
  parts.push(key.length === 1 ? key.toLowerCase() : key.toLowerCase());
  return parts.join('+');
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function KeyboardProvider({ children }: { children: ReactNode }): ReactNode {
  const sources = useRef(new Set<ShortcutSource>());
  const [version, setVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((source: ShortcutSource) => {
    sources.current.add(source);
    setVersion((v) => v + 1);
    return () => {
      sources.current.delete(source);
      setVersion((v) => v + 1);
    };
  }, []);

  const collect = useCallback(
    (): Shortcut[] => [...sources.current].flatMap((source) => source()).filter((s) => s.enabled !== false),
    [],
  );

  // `version` is the signal that the registered set changed.
  const shortcuts = useMemo(() => collect(), [collect, version, helpOpen, paletteOpen]);

  const clearPending = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return;
      const combo = comboFromEvent(event);
      if (combo === 'escape') {
        clearPending();
        return;
      }
      const typing = isTypingTarget(event.target);
      const all = collect();
      const usable = all.filter((shortcut) => !typing || shortcut.allowInInput || shortcut.keys.includes('mod+'));

      if (pending) {
        const sequence = `${pending} ${combo}`;
        const match = usable.find((shortcut) => shortcut.keys === sequence);
        clearPending();
        if (match) {
          event.preventDefault();
          match.run();
          return;
        }
      }

      const direct = usable.find((shortcut) => shortcut.keys === combo);
      if (direct) {
        event.preventDefault();
        direct.run();
        return;
      }

      if (usable.some((shortcut) => shortcut.keys.startsWith(`${combo} `))) {
        event.preventDefault();
        setPending(combo);
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        pendingTimer.current = setTimeout(() => setPending(null), 1500);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [collect, pending, clearPending]);

  useEffect(() => () => clearPending(), [clearPending]);

  const value = useMemo<KeyboardContextValue>(
    () => ({ register, shortcuts, helpOpen, setHelpOpen, paletteOpen, setPaletteOpen, pending }),
    [register, shortcuts, helpOpen, paletteOpen, pending],
  );

  // The `?` sheet and the palette are rendered by the shell, which owns their content.
  return createElement(KeyboardContext.Provider, { value }, children);
}

export function useKeyboard(): KeyboardContextValue {
  const value = useContext(KeyboardContext);
  if (!value) throw new Error('useKeyboard must be used inside <KeyboardProvider>');
  return value;
}

/** Same, but `null` outside a provider — for components that only *decorate* with shortcuts. */
export function useOptionalKeyboard(): KeyboardContextValue | null {
  return useContext(KeyboardContext);
}

/**
 * The binding a command palette entry should show, matched by what the shortcut does rather
 * than by an id the two lists would have to keep in step: a shortcut described "Go to sessions"
 * is the keyboard form of the command titled "Sessions". Returns `undefined` when nothing
 * matches, and the caller falls back to the command's group label.
 */
export function findShortcutKeys(shortcuts: Shortcut[], title: string): string | undefined {
  const wanted = normalizeAction(title);
  return shortcuts.find((shortcut) => normalizeAction(shortcut.description) === wanted)?.keys;
}

function normalizeAction(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^go to /, '')
    .replace(/[.·]+$/, '');
}

/**
 * Registers shortcuts for as long as the component is mounted. The array may be
 * rebuilt on every render — only ids, key strings and enabled flags force a re-register.
 */
export function useShortcuts(shortcuts: Shortcut[]): void {
  const { register } = useKeyboard();
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  const signature = shortcuts.map((s) => `${s.id}:${s.keys}:${s.enabled !== false}`).join('|');
  useEffect(() => register(() => latest.current), [register, signature]);
}

/** The `?` help sheet and `⌘K` palette are always available. */
export function useBaseShortcuts(): void {
  const { setHelpOpen, setPaletteOpen, helpOpen, paletteOpen } = useKeyboard();
  useShortcuts([
    {
      id: 'help',
      keys: '?',
      description: 'Keyboard shortcuts',
      group: 'View',
      run: () => setHelpOpen(!helpOpen),
    },
    {
      id: 'palette',
      keys: 'mod+k',
      description: 'Command palette',
      group: 'Search',
      run: () => setPaletteOpen(!paletteOpen),
      allowInInput: true,
    },
  ]);
}

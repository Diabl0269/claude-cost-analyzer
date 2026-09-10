/**
 * Accessibility primitives: a polite live region, roving tabindex, focus trap and
 * background inerting. Used by tables, trees, tabs, dialogs and the palette.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const LIVE_REGION_ID = 'cca-live-region';

function liveRegion(politeness: 'polite' | 'assertive'): HTMLElement {
  const id = politeness === 'polite' ? LIVE_REGION_ID : `${LIVE_REGION_ID}-assertive`;
  const existing = document.getElementById(id);
  if (existing) return existing;
  const region = document.createElement('div');
  region.id = id;
  region.setAttribute('aria-live', politeness);
  region.setAttribute('aria-atomic', 'true');
  region.className = 'visually-hidden';
  document.body.appendChild(region);
  return region;
}

/**
 * Announces a message to screen readers without moving focus.
 * The region is cleared first so repeated identical messages are still read.
 */
export function useAnnounce(): (message: string, politeness?: 'polite' | 'assertive') => void {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    },
    [],
  );
  return useCallback((message: string, politeness: 'polite' | 'assertive' = 'polite') => {
    const region = liveRegion(politeness);
    region.textContent = '';
    timers.current.push(
      setTimeout(() => {
        region.textContent = message;
      }, 40),
    );
  }, []);
}

export type RovingOrientation = 'vertical' | 'horizontal' | 'both';

export interface RovingOptions {
  itemCount: number;
  orientation?: RovingOrientation;
  loop?: boolean;
  initialIndex?: number;
  onActivate?: (index: number) => void;
}

export interface RovingApi {
  activeIndex: number;
  setActiveIndex: (index: number, options?: { focus?: boolean }) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
  /** props for the scroll/DOM container that owns the items */
  containerRef: RefObject<HTMLElement | null>;
  /** props each item spreads; `data-roving-index` is how the hook finds the DOM node */
  itemProps: (index: number) => {
    tabIndex: number;
    'data-roving-index': number;
    onFocus: () => void;
  };
}

/**
 * One tab stop for a list of items, arrow keys inside.
 * Items must spread `itemProps(index)` and live inside `containerRef`.
 */
export function useRovingTabIndex(options: RovingOptions): RovingApi {
  const { itemCount, orientation = 'vertical', loop = false, initialIndex = 0, onActivate } = options;
  const containerRef = useRef<HTMLElement | null>(null);
  const [activeIndex, setIndex] = useState(initialIndex);

  const focusIndex = useCallback((index: number) => {
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-roving-index="${index}"]`);
    node?.focus();
  }, []);

  const setActiveIndex = useCallback(
    (index: number, opts?: { focus?: boolean }) => {
      const clamped = Math.max(0, Math.min(index, itemCount - 1));
      setIndex(clamped);
      if (opts?.focus !== false) requestAnimationFrame(() => focusIndex(clamped));
    },
    [itemCount, focusIndex],
  );

  const move = useCallback(
    (delta: number) => {
      if (itemCount === 0) return;
      const next = activeIndex + delta;
      const wrapped = loop ? (next + itemCount) % itemCount : Math.max(0, Math.min(next, itemCount - 1));
      setActiveIndex(wrapped);
    },
    [activeIndex, itemCount, loop, setActiveIndex],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const vertical = orientation !== 'horizontal';
      const horizontal = orientation !== 'vertical';
      switch (event.key) {
        case 'ArrowDown':
          if (!vertical) return;
          event.preventDefault();
          move(1);
          break;
        case 'ArrowUp':
          if (!vertical) return;
          event.preventDefault();
          move(-1);
          break;
        case 'ArrowRight':
          if (!horizontal) return;
          event.preventDefault();
          move(1);
          break;
        case 'ArrowLeft':
          if (!horizontal) return;
          event.preventDefault();
          move(-1);
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(itemCount - 1);
          break;
        case 'Enter':
        case ' ':
          if (onActivate) {
            event.preventDefault();
            onActivate(activeIndex);
          }
          break;
        default:
          break;
      }
    },
    [orientation, move, setActiveIndex, itemCount, onActivate, activeIndex],
  );

  return {
    activeIndex: Math.min(activeIndex, Math.max(0, itemCount - 1)),
    setActiveIndex,
    onKeyDown,
    containerRef,
    itemProps: (index: number) => ({
      tabIndex: index === Math.min(activeIndex, Math.max(0, itemCount - 1)) ? 0 : -1,
      'data-roving-index': index,
      onFocus: () => setIndex(index),
    }),
  };
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export interface FocusTrapOptions {
  active: boolean;
  onEscape?: () => void;
  restoreFocus?: boolean;
  /** focused on open; defaults to the first focusable node, then the container */
  initialFocus?: RefObject<HTMLElement | null>;
}

/** Keeps Tab inside `ref`, closes on Escape, and restores focus to the opener. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, options: FocusTrapOptions): void {
  const { active, onEscape, restoreFocus = true, initialFocus } = options;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = initialFocus?.current ?? focusableWithin(container)[0] ?? container;
    if (!container.hasAttribute('tabindex') && target === container) container.setAttribute('tabindex', '-1');
    target.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (!restoreFocus || !opener?.isConnected) return;
      opener.focus();
      // The opener can still be `inert` (or detached from layout) at cleanup time, in which
      // case `focus()` silently does nothing and focus falls to <body>. Retry once the DOM
      // has settled so Escape always returns the user to where they were.
      if (document.activeElement !== opener) {
        requestAnimationFrame(() => {
          if (opener.isConnected && document.activeElement !== opener) opener.focus();
        });
      }
    };
  }, [active, ref, restoreFocus, initialFocus]);
}

/**
 * Marks every top-level sibling of `container` inert while a modal is open, so
 * screen readers and Tab both stop at the dialog.
 */
export function useBackgroundInert(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const touched: HTMLElement[] = [];
    for (const child of [...document.body.children]) {
      if (!(child instanceof HTMLElement) || child.contains(container) || child === container) continue;
      if (child.inert) continue;
      child.inert = true;
      touched.push(child);
    }
    return () => {
      for (const node of touched) node.inert = false;
    };
  }, [containerRef, active]);
}

/** Calls `handler` on a pointerdown outside `ref` (popovers, menus). */
export function useClickOutside(ref: RefObject<HTMLElement | null>, active: boolean, handler: () => void): void {
  const callback = useRef(handler);
  callback.current = handler;
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent): void => {
      const node = ref.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) callback.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [ref, active]);
}

/** True while the user prefers reduced motion; charts use it to skip transitions. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

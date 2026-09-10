import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { focusableWithin, useClickOutside } from '@/lib/a11y';
import styles from './Popover.module.css';

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog';
  'aria-controls': string | undefined;
}

export interface PopoverProps {
  /** the button that opens the panel; spread the provided props onto it */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  /** accessible name of the panel */
  label: string;
  placement?: 'bottom-start' | 'bottom-end';
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Picks what to focus when the panel opens — the active preset, the first field. Defaults to
   * the panel's first focusable element, then the panel itself.
   */
  initialFocus?: (panel: HTMLElement) => HTMLElement | null;
}

/**
 * Non-modal panel anchored to its trigger.
 *
 * The panel is portaled to the end of `<body>`, so DOM order is no help to the keyboard: Tab from
 * the trigger used to walk on into the rest of the page and Escape only worked once focus was
 * already inside. So opening moves focus into the panel, Escape from either the trigger or the
 * panel closes it, and tabbing past the panel's last (or before its first) focusable element
 * closes it too — focus returning to the trigger in every case.
 */
export function Popover({
  trigger,
  children,
  label,
  placement = 'bottom-start',
  width = 260,
  open,
  onOpenChange,
  initialFocus,
}: PopoverProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [uncontrolled, setUncontrolled] = useState(false);
  const isOpen = open ?? uncontrolled;
  const [position, setPosition] = useState({ top: 0, left: 0 });
  // Read through a ref: callers pass an inline arrow, and depending on its identity would
  // re-run the focus effect on every render — stealing the caret out of a field in the panel.
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next);
      onOpenChange?.(next);
      if (!next) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  useClickOutside(panelRef, isOpen, () => {
    setUncontrolled(false);
    onOpenChange?.(false);
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const left = placement === 'bottom-end' ? anchor.right - width : anchor.left;
    setPosition({
      top: anchor.bottom + 6,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    });
  }, [isOpen, placement, width]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target = initialFocusRef.current?.(panel) ?? focusableWithin(panel)[0] ?? panel;
    if (target === panel && !panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
    target.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const panel = panelRef.current;
      if (!panel) return;
      const node = event.target instanceof Node ? event.target : null;
      const inside = node !== null && (panel.contains(node) || (triggerRef.current?.contains(node) ?? false));

      if (event.key === 'Escape') {
        if (!inside) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !panel.contains(document.activeElement)) return;

      const items = focusableWithin(panel);
      const current = document.activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      const leaving = event.shiftKey ? current === first || current === panel || items.length === 0 : current === last || items.length === 0;
      if (!leaving) return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, setOpen]);

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen(!isOpen),
        'aria-expanded': isOpen,
        'aria-haspopup': 'dialog',
        'aria-controls': isOpen ? id : undefined,
      })}
      {isOpen
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={label}
              className={styles.panel}
              style={{ top: position.top, left: position.left, width }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

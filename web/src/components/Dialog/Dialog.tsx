import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { focusableWithin, useBackgroundInert, useFocusTrap } from '@/lib/a11y';
import { IconButton } from '@/components/IconButton';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** drops the built-in header; the caller renders its own (command palette) */
  bare?: boolean;
  /** `alertdialog` for destructive confirmations */
  alert?: boolean;
  /** aligns the panel to the top of the viewport rather than centring it */
  align?: 'center' | 'top';
}

/** Modal dialog: focus trap, Escape, restored focus, inert background, scroll lock. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  bare = false,
  alert = false,
  align = 'center',
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const id = useId();
  // A body that scrolls but holds nothing focusable is unreachable by keyboard, so it needs
  // its own tab stop (axe `scrollable-region-focusable`). Bodies full of controls do not.
  const [scrollStop, setScrollStop] = useState(false);

  // Order matters: effect cleanups run in declaration order, so the background must stop
  // being `inert` before the focus trap tries to restore focus to the opener behind it.
  useBackgroundInert(panelRef, open);
  // Focus lands on the dialog's own heading rather than on its Close button: the first thing a
  // reader hears is what this dialog is, not the way out of it. A caller with a field to fill
  // (the command palette) still passes `initialFocusRef` and wins.
  const initialFocus = initialFocusRef ?? (bare ? null : titleRef);
  useFocusTrap(panelRef, {
    active: open,
    onEscape: onClose,
    ...(initialFocus ? { initialFocus } : {}),
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!open || !node) {
      setScrollStop(false);
      return;
    }
    const scrolls = node.scrollHeight > node.clientHeight + 1;
    setScrollStop(scrolls && focusableWithin(node).length === 0);
  }, [open, children]);

  if (!open) return null;

  return createPortal(
    <div className={styles.scrim} data-align={align} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        className={[styles.panel, styles[size]].join(' ')}
        onKeyDown={(event) => {
          // The heading is not in the tab ring, so Shift-Tab off it would leave the dialog.
          if (event.key !== 'Tab' || !event.shiftKey || !panelRef.current) return;
          if (document.activeElement !== titleRef.current) return;
          const items = focusableWithin(panelRef.current);
          const last = items[items.length - 1];
          if (!last) return;
          event.preventDefault();
          last.focus();
        }}
      >
        {bare ? (
          <h2 id={`${id}-title`} className="visually-hidden">
            {title}
          </h2>
        ) : (
          <header className={styles.header}>
            <div>
              <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className={styles.title}>
                {title}
              </h2>
              {description ? (
                <p id={`${id}-description`} className={styles.description}>
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton icon="close" label="Close dialog" onClick={onClose} />
          </header>
        )}
        <div
          ref={bodyRef}
          className={bare ? styles.bareBody : styles.body}
          tabIndex={scrollStop ? 0 : undefined}
          role={scrollStop ? 'group' : undefined}
          aria-label={scrollStop ? 'Dialog content' : undefined}
        >
          {children}
        </div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

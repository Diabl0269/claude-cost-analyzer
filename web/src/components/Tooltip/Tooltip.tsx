import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  /** a single focusable element; it receives `aria-describedby` */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  placement?: TooltipPlacement;
  /** ms before showing on hover; focus shows immediately */
  delay?: number;
  maxWidth?: number;
}

interface Position {
  top: number;
  left: number;
}

/**
 * WCAG 2.2 1.4.13: appears on hover *and* focus, stays while the pointer is over it,
 * and closes on Escape without moving focus.
 */
export function Tooltip({ content, children, placement = 'top', delay = 120, maxWidth = 260 }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback(
    (immediate = false) => {
      clear();
      if (immediate) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [clear, delay],
  );

  const hide = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(false), 80);
  }, [clear]);

  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        clear();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, clear]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!anchor || !bubble) return;
    const gap = 8;
    let top = anchor.top - bubble.height - gap;
    let left = anchor.left + anchor.width / 2 - bubble.width / 2;
    if (placement === 'bottom') top = anchor.bottom + gap;
    if (placement === 'left') {
      top = anchor.top + anchor.height / 2 - bubble.height / 2;
      left = anchor.left - bubble.width - gap;
    }
    if (placement === 'right') {
      top = anchor.top + anchor.height / 2 - bubble.height / 2;
      left = anchor.right + gap;
    }
    if (top < 4) top = anchor.bottom + gap;
    left = Math.max(8, Math.min(left, window.innerWidth - bubble.width - 8));
    setPosition({ top, left });
  }, [open, placement, content]);

  const child = cloneElement(children, { 'aria-describedby': open ? id : undefined });

  return (
    <>
      <span
        ref={anchorRef}
        className={styles.anchor}
        onPointerEnter={() => show()}
        onPointerLeave={hide}
        onFocusCapture={() => show(true)}
        onBlurCapture={hide}
      >
        {child}
        {/*
          The accessible copy lives next to the trigger, inside whatever landmark the trigger
          is in; the visible bubble is portaled to <body> to escape `overflow: hidden` ancestors
          and is hidden from assistive tech so the text is not announced twice (and so page
          content stays inside a landmark).
        */}
        {open ? (
          <span id={id} role="tooltip" className="visually-hidden">
            {content}
          </span>
        ) : null}
      </span>
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              aria-hidden="true"
              className={styles.bubble}
              style={{ top: position.top, left: position.left, maxWidth }}
              onPointerEnter={clear}
              onPointerLeave={hide}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

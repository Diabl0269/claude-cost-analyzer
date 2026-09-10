import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@/components/IconButton';
import { Icon, type IconName } from '@/components/Icon';
import styles from './Toast.module.css';

export type ToastTone = 'info' | 'save' | 'cost' | 'warn';

export interface ToastOptions {
  title: string;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms; 0 keeps it until dismissed (used for errors) */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  save: 'check',
  cost: 'warning',
  warn: 'warning',
};

/** Renders the live region once, at the root of the app. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const schedule = useCallback(
    (id: number, duration: number) => {
      if (duration <= 0) return;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { ...options, id }].slice(-4));
      schedule(id, options.duration ?? 6000);
      return id;
    },
    [schedule],
  );

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="region" aria-label="Notifications" data-print-hide>
        <ol className={styles.list} aria-live="polite" aria-atomic="false">
          {toasts.map((item) => (
            <li
              key={item.id}
              className={styles.toast}
              data-tone={item.tone ?? 'info'}
              onPointerEnter={() => {
                const timer = timers.current.get(item.id);
                if (timer) clearTimeout(timer);
              }}
              onPointerLeave={() => schedule(item.id, item.duration ?? 6000)}
            >
              <Icon name={TONE_ICON[item.tone ?? 'info']} className={styles.icon} />
              <div className={styles.body}>
                <p className={styles.title}>{item.title}</p>
                {item.description ? <p className={styles.description}>{item.description}</p> : null}
                {item.action ? (
                  <button type="button" className={styles.action} onClick={item.action.onClick}>
                    {item.action.label}
                  </button>
                ) : null}
              </div>
              <IconButton icon="close" label={`Dismiss: ${item.title}`} size="sm" onClick={() => dismiss(item.id)} />
            </li>
          ))}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}

import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import styles from './Callout.module.css';

export type CalloutTone = 'info' | 'warn' | 'cost' | 'save';

export interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}

const DEFAULT_ICON: Record<CalloutTone, IconName> = {
  info: 'info',
  warn: 'warning',
  cost: 'warning',
  save: 'insight',
};

/** A note with a coloured left rule — never a filled card. */
export function Callout({ tone = 'info', title, children, icon, action }: CalloutProps) {
  return (
    <div className={styles.callout} data-tone={tone} role={tone === 'warn' ? 'alert' : undefined}>
      <Icon name={icon ?? DEFAULT_ICON[tone]} className={styles.icon} />
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div className={styles.text}>{children}</div>
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  /** compact variant for inside tables and panels */
  inline?: boolean;
}

export function EmptyState({ title, description, icon = 'sessions', action, inline = false }: EmptyStateProps) {
  return (
    <div className={[styles.empty, inline ? styles.inline : null].filter(Boolean).join(' ')}>
      <Icon name={icon} size={inline ? 16 : 22} className={styles.icon} />
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** required: the button has no visible text */
  label: string;
  variant?: 'ghost' | 'outline';
  size?: 'sm' | 'md';
  rotate?: number;
  active?: boolean;
}

/** Icon-only control. Hit target stays ≥ 24px even at `sm` (WCAG 2.2 target size). */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  rotate,
  active,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], styles[size], active ? styles.active : null, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      <Icon name={icon} rotate={rotate ?? 0} />
    </button>
  );
}

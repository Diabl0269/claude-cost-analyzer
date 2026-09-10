import { useId, type ReactNode } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** puts the control before the label */
  leading?: boolean;
}

/** ARIA switch. The track is a hairline, the knob is ink — no pill gradients. */
export function Switch({ checked, onChange, label, description, disabled = false, leading = false }: SwitchProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={[styles.wrap, leading ? styles.leading : null].filter(Boolean).join(' ')}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-describedby={descriptionId}
        disabled={disabled}
        className={styles.track}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
      <label className={styles.text} htmlFor={id}>
        <span className={styles.label}>{label}</span>
        {description ? (
          <span className={styles.description} id={descriptionId}>
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
}

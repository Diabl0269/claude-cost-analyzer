import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon } from '@/components/Icon';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'children' | 'size'> {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** grouped options render as <optgroup> */
  groups?: { label: string; options: SelectOption[] }[];
  hint?: ReactNode;
  hideLabel?: boolean;
  size?: 'sm' | 'md';
}

/** Native `<select>` with our chrome — the platform menu beats a custom listbox here. */
export function Select({ label, value, onChange, options, groups, hint, hideLabel = false, size = 'sm', className, ...rest }: SelectProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
      </label>
      <div className={[styles.control, styles[size]].join(' ')}>
        <select
          id={id}
          className={styles.select}
          value={value}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {groups?.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Icon name="chevron" size={12} rotate={90} className={styles.chevron} />
      </div>
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

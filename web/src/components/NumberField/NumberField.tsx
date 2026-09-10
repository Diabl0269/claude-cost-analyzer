import { useId, type ReactNode } from 'react';
import styles from './NumberField.module.css';

export interface NumberFieldProps {
  label: ReactNode;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** e.g. `$` */
  prefix?: string;
  /** e.g. `/ MTok` */
  suffix?: string;
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  width?: number;
  /** decimals shown when not focused */
  precision?: number;
}

/** Numeric input with tabular figures, a unit affix and `aria-describedby` wiring. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  hint,
  error,
  placeholder,
  disabled = false,
  hideLabel = false,
  width,
  precision,
}: NumberFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const text = value === null ? '' : precision === undefined ? String(value) : value.toFixed(precision);

  return (
    <div className={styles.field} style={width ? { width } : undefined}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
      </label>
      <div className={[styles.control, error ? styles.invalid : null].filter(Boolean).join(' ')}>
        {prefix ? <span className={styles.affix}>{prefix}</span> : null}
        <input
          id={id}
          type="number"
          className={['num', styles.input].join(' ')}
          value={text}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          inputMode="decimal"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              onChange(null);
              return;
            }
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
        {suffix ? <span className={styles.affix}>{suffix}</span> : null}
      </div>
      {hint && !error ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

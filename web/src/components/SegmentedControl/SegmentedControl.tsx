import { useRef, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  /** accessible name when the label is a glyph */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** accessible group name */
  label: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

/** ARIA radiogroup: one tab stop, arrow keys select. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
  fullWidth = false,
}: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  const move = (delta: number): void => {
    if (options.length === 0) return;
    let next = index;
    for (let step = 0; step < options.length; step += 1) {
      next = (next + delta + options.length) % options.length;
      const candidate = options[next];
      if (candidate && !candidate.disabled) {
        onChange(candidate.value);
        ref.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
        return;
      }
    }
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={[styles.group, styles[size], fullWidth ? styles.full : null].filter(Boolean).join(' ')}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option, optionIndex) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-index={optionIndex}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            title={option.title}
            className={styles.option}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <Icon name={option.icon} size={14} /> : null}
            <span className={styles.label}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

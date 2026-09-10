import { useId, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { RANGE_PRESETS, formatRangeSentence, presetRange, rangeLabel, type DateRangeValue, type RangePresetId } from '@/lib/range';
import styles from './DateRange.module.css';

export interface DateRangeProps {
  value: DateRangeValue;
  onPreset: (preset: RangePresetId) => void;
  onBounds: (bounds: { from?: string; to?: string }) => void;
  /**
   * Collapses the control to one button reading the active window, with the presets and the two
   * bounds inside a popover. The top bar uses it at 1180px and under, where the full row does
   * not fit — the range used to be hidden outright, which put the app's primary filter out of
   * reach on a 13" laptop while empty states went on telling the reader to widen it.
   */
  compact?: boolean;
  label?: string;
}

/** Presets plus explicit bounds. Values are local `YYYY-MM-DD`, matching the API. */
export function DateRange({ value, onPreset, onBounds, compact = false, label = 'Date range' }: DateRangeProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // A preset carries no explicit bounds, but the inputs should still read the window it resolves
  // to — an empty `dd/mm/yyyy` beside an active "30 days" looks unfinished. "All" keeps its lower
  // bound empty: the floor is a technicality, not a date anyone chose.
  const resolved = value.from === undefined && value.to === undefined ? presetRange(value.preset) : {};
  const shown = {
    from: value.from ?? (value.preset === 'all' ? undefined : resolved.from),
    to: value.to ?? resolved.to,
  };

  const presets = (
    <div className={styles.presets}>
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={styles.preset}
          aria-pressed={value.preset === preset.id}
          onClick={() => {
            onPreset(preset.id);
            // A preset is a decision; the panel has served its purpose and hands focus back.
            setOpen(false);
          }}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );

  const bounds = (
    <div className={styles.bounds}>
      <label className="visually-hidden" htmlFor={`${id}-from`}>
        From date
      </label>
      <input
        id={`${id}-from`}
        type="date"
        className={['num', styles.date].join(' ')}
        value={shown.from ?? ''}
        max={shown.to}
        onChange={(event) => onBounds({ from: event.target.value || undefined, to: shown.to })}
      />
      <span className={styles.dash} aria-hidden="true">
        –
      </span>
      <label className="visually-hidden" htmlFor={`${id}-to`}>
        To date
      </label>
      <input
        id={`${id}-to`}
        type="date"
        className={['num', styles.date].join(' ')}
        value={shown.to ?? ''}
        min={shown.from}
        onChange={(event) => onBounds({ from: shown.from, to: event.target.value || undefined })}
      />
    </div>
  );

  if (compact) {
    return (
      <Popover
        label={label}
        placement="bottom-end"
        width={272}
        open={open}
        onOpenChange={setOpen}
        // Opening lands on the active preset rather than the first one, so the panel reads as
        // "here is the window you are in"; Popover handles Escape and tabbing back out.
        initialFocus={(panel) => panel.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className={styles.trigger}
            aria-label={`${label}: ${formatRangeSentence(value.from, value.to)}`}
          >
            <span className={styles.triggerLabel}>{rangeLabel(value)}</span>
            <Icon name="chevron" size={12} rotate={90} className={styles.triggerCaret} />
          </button>
        )}
      >
        <div className={styles.panel}>
          <p className={styles.panelRange}>Window: {formatRangeSentence(value.from, value.to)}</p>
          {presets}
          {bounds}
        </div>
      </Popover>
    );
  }

  return (
    <div className={styles.wrap} role="group" aria-label={label}>
      {presets}
      {bounds}
    </div>
  );
}

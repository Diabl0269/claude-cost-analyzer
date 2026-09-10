import { useMemo, useState } from 'react';
import { Button, IconButton, Money, Popover, Select } from '@/components';
import type { CurrencyDisplay } from '@/lib/format';
import { usePricing } from '@/lib/queries';
import { useWhatIf } from '@/lib/whatif';
import styles from './Overview.module.css';

export interface WhatIfPickerProps {
  /** priced total with the substitutions applied minus the real total; null while either is loading */
  deltaUsd: number | null;
  currency: CurrencyDisplay;
}

/**
 * What-if pricing simulator (SPEC §10.4). Substitutions live in the URL, so a "price Opus 5 as
 * Sonnet 5" view is shareable and survives a reload; nothing is written to the pricing config.
 */
export function WhatIfPicker({ deltaUsd, currency }: WhatIfPickerProps) {
  const pricing = usePricing();
  const whatIf = useWhatIf();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');

  const options = useMemo(() => {
    const models = (pricing.data?.models ?? []).filter((model) => !model.retired && model.key !== 'synthetic');
    return models
      .map((model) => ({ value: model.key, label: model.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [pricing.data]);

  const labelFor = (key: string): string => options.find((option) => option.value === key)?.label ?? key;
  const entries = Object.entries(whatIf.map);
  const canApply = source !== '' && target !== '' && source !== target;

  return (
    <div className={styles.whatIfChips}>
      {entries.map(([from, to]) => (
        <span key={from} className={styles.chip}>
          <span>
            {labelFor(from)} priced as {labelFor(to)}
          </span>
          <IconButton
            icon="close"
            size="sm"
            label={`Stop pricing ${labelFor(from)} as ${labelFor(to)}`}
            onClick={() => whatIf.substitute(from, null)}
          />
        </span>
      ))}

      {whatIf.active && deltaUsd !== null ? (
        <span className="ui-xs muted">
          {'→ '}
          <Money usd={deltaUsd} currency={currency} delta tone="auto" /> against list prices
        </span>
      ) : null}

      <Popover
        label="What-if pricing"
        width={280}
        trigger={(props) => (
          <Button {...props} variant={whatIf.active ? 'secondary' : 'ghost'} size="sm" iconStart="model">
            What-if pricing{whatIf.active ? ` (${entries.length})` : ''}
          </Button>
        )}
      >
        <div className={styles.whatIfForm}>
          <p className="ui-xs muted">Re-price one model at another&rsquo;s list rates for this view only. Token counts do not change.</p>
          <Select
            label="Price this model"
            value={source}
            onChange={setSource}
            options={[{ value: '', label: 'Choose a model' }, ...options]}
          />
          <Select
            label="at the rates of"
            value={target}
            onChange={setTarget}
            options={[{ value: '', label: 'Choose a model' }, ...options]}
          />
          <div className="cluster">
            <Button
              variant="primary"
              size="sm"
              disabled={!canApply}
              onClick={() => {
                if (canApply) whatIf.substitute(source, target);
              }}
            >
              Apply
            </Button>
            {whatIf.active ? (
              <Button variant="ghost" size="sm" onClick={() => whatIf.clear()}>
                Clear all
              </Button>
            ) : null}
          </div>
        </div>
      </Popover>
    </div>
  );
}

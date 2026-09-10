import type { ModelCostRow } from '@core/types';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { Select } from '@/components/Select';
import { usePricing } from '@/lib/queries';
import type { WhatIfStore } from '@/lib/whatif';
import styles from './WhatIf.module.css';

export interface WhatIfProps {
  whatIf: WhatIfStore;
  /** the models this session actually used */
  models: ModelCostRow[];
}

/**
 * Price simulation for one view: swap a model's prices for another's without saving.
 * The substitution lives in the URL, so a "what if this had run on Sonnet" link is shareable.
 */
export function WhatIf({ whatIf, models }: WhatIfProps) {
  const pricing = usePricing();
  const options = [
    { value: '', label: 'Its own prices' },
    ...(pricing.data?.models ?? []).filter((model) => !model.retired).map((model) => ({ value: model.key, label: model.label })),
  ];
  const priced = models.filter((row): row is ModelCostRow & { modelKey: string } => row.modelKey !== null);

  return (
    <Popover
      label="Price simulation"
      placement="bottom-end"
      width={300}
      trigger={(props) => (
        <button type="button" className={styles.trigger} data-active={whatIf.active} {...props}>
          <Icon name="model" size={14} />
          {whatIf.active ? 'Simulating prices' : 'What if…'}
        </button>
      )}
    >
      <div className="stack stack-sm">
        <p className={styles.intro}>
          Re-price this session as if a model had cost what another one costs. Nothing is saved; the
          simulation lives in the URL.
        </p>
        {priced.length === 0 ? (
          <p className={styles.intro}>No priced model in this session.</p>
        ) : (
          priced.map((row) => (
            <Select
              key={row.modelKey}
              label={`${row.label} priced as`}
              value={whatIf.map[row.modelKey] ?? ''}
              options={options}
              onChange={(value) => whatIf.substitute(row.modelKey, value === '' ? null : value)}
            />
          ))
        )}
        {whatIf.active ? (
          <Button variant="ghost" size="sm" iconStart="close" onClick={whatIf.clear}>
            Reset to real prices
          </Button>
        ) : null}
      </div>
    </Popover>
  );
}

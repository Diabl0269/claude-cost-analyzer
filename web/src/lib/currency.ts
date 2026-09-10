/**
 * Display currency. Every amount in the API is USD; the currency setting (SPEC §8.4) is a
 * presentation-only code + manual rate, so it is applied at render time by `<Money>` rather
 * than anywhere in the data layer.
 */
import { useMemo } from 'react';
import type { CurrencyDisplay } from './format';
import { useSettings } from './queries';

export const USD: CurrencyDisplay = { code: 'USD', rate: 1 };

/** The configured display currency, falling back to USD until settings have loaded. */
export function useCurrency(): CurrencyDisplay {
  const settings = useSettings();
  const code = settings.data?.currency.code;
  const rate = settings.data?.currency.rate;
  return useMemo(() => (code && typeof rate === 'number' && rate > 0 ? { code, rate } : USD), [code, rate]);
}

/**
 * What-if pricing: substitute one model's prices for another's in a view without
 * saving anything. Encoded in the URL as `whatIf=opus-5>sonnet-5,fable-5-1>opus-5`
 * and passed straight through to the API as `RangeQuery.whatIf`.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type WhatIfMap = Readonly<Record<string, string>>;

const PAIR = '>';

export function parseWhatIf(param: string | null | undefined): WhatIfMap {
  if (!param) return {};
  const map: Record<string, string> = {};
  for (const entry of param.split(',')) {
    const [from, to] = entry.split(PAIR);
    const source = from?.trim();
    const target = to?.trim();
    if (source && target) map[source] = target;
  }
  return map;
}

export function serializeWhatIf(map: WhatIfMap): string | undefined {
  const entries = Object.entries(map)
    .filter(([from, to]) => from && to && from !== to)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([from, to]) => `${from}${PAIR}${to}`).join(',') : undefined;
}

export interface WhatIfStore {
  map: WhatIfMap;
  /** the encoded value to send as `RangeQuery.whatIf` (undefined when inactive) */
  param: string | undefined;
  active: boolean;
  substitute: (fromModelKey: string, toModelKey: string | null) => void;
  clear: () => void;
}

export function useWhatIf(): WhatIfStore {
  const [params, setParams] = useSearchParams();
  const raw = params.get('whatIf');
  const map = useMemo(() => parseWhatIf(raw), [raw]);

  const write = useCallback(
    (next: WhatIfMap) => {
      const encoded = serializeWhatIf(next);
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (encoded) updated.set('whatIf', encoded);
          else updated.delete('whatIf');
          return updated;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );

  const substitute = useCallback(
    (fromModelKey: string, toModelKey: string | null) => {
      const next: Record<string, string> = { ...map };
      if (toModelKey && toModelKey !== fromModelKey) next[fromModelKey] = toModelKey;
      else delete next[fromModelKey];
      write(next);
    },
    [map, write],
  );

  const clear = useCallback(() => write({}), [write]);

  return useMemo(
    () => ({ map, param: serializeWhatIf(map), active: Object.keys(map).length > 0, substitute, clear }),
    [map, substitute, clear],
  );
}

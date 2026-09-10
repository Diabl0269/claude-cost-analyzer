/** Shared chart vocabulary: token classes, model hues and the heat ramp. */
import { useEffect, useState } from 'react';
import type { ModelFamily } from '@core/types';

export type TokenClassKey = 'output' | 'input' | 'cacheWrite' | 'cacheRead';

export const TOKEN_CLASS_ORDER: TokenClassKey[] = ['output', 'input', 'cacheWrite', 'cacheRead'];

export const TOKEN_CLASS_COLOR: Record<TokenClassKey, string> = {
  output: 'var(--t-output)',
  input: 'var(--t-input)',
  cacheWrite: 'var(--t-cache-write)',
  cacheRead: 'var(--t-cache-read)',
};

export const TOKEN_CLASS_LABEL: Record<TokenClassKey, string> = {
  output: 'Output',
  input: 'Input',
  cacheWrite: 'Cache write',
  cacheRead: 'Cache read',
};

/** Fill pattern per class so the chart survives greyscale printing and colour blindness. */
export const TOKEN_CLASS_PATTERN: Record<TokenClassKey, 'solid' | 'hatch' | 'dots' | 'grid'> = {
  output: 'solid',
  input: 'grid',
  cacheWrite: 'hatch',
  cacheRead: 'dots',
};

export const MODEL_FAMILY_COLOR: Record<ModelFamily, string> = {
  opus: 'var(--m-opus)',
  sonnet: 'var(--m-sonnet)',
  haiku: 'var(--m-haiku)',
  fable: 'var(--m-fable)',
  mythos: 'var(--m-mythos)',
  synthetic: 'var(--m-other)',
  other: 'var(--m-other)',
};

export const HEAT_STEPS = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'];

/**
 * Bucket a value into the 5-step heat ramp, or `null` when there is nothing to shade at all
 * (nothing billed). Step 0 is the lowest quartile of real spend, which is not the same thing as
 * a day that billed nothing — `HeatStrip` draws that one as bare paper — so the two are not
 * folded into one value.
 */
export function heatStep(value: number, max: number): number | null {
  if (!(value > 0)) return null;
  const ratio = max > 0 ? value / max : 1;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** Tracks an element's content width (charts need real pixels, not a viewBox stretch). */
export function useElementWidth(ref: { current: HTMLElement | null }, fallback = 640): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(120, Math.round(entry.contentRect.width)));
    });
    observer.observe(node);
    setWidth(Math.max(120, Math.round(node.getBoundingClientRect().width)) || fallback);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}

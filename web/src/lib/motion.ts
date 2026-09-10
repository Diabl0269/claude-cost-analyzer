/**
 * Reduced-motion preference (SPEC §8.4). `system` defers to `prefers-reduced-motion`, which
 * `design/base.css` already honours; `on`/`off` pin it with a `data-motion` attribute the same
 * stylesheet reads.
 */
export type MotionPreference = 'system' | 'on' | 'off';

/** Writes `data-motion` on `<html>`. Safe to call repeatedly. */
export function applyMotionPreference(preference: MotionPreference): void {
  const root = document.documentElement;
  if (preference === 'on') root.dataset['motion'] = 'reduce';
  else if (preference === 'off') root.dataset['motion'] = 'full';
  else delete root.dataset['motion'];
}

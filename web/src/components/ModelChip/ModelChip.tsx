import type { ModelFamily } from '@core/types';
import { formatModelLabel } from '@/lib/format';
import styles from './ModelChip.module.css';

export interface ModelChipProps {
  /** raw model id (`claude-opus-5[1m]`) or a pricing key (`opus-5`) */
  model: string;
  /** overrides the derived label */
  label?: string;
  family?: ModelFamily;
  size?: 'sm' | 'md';
  /** hide the text, keep the glyph (dense tables) */
  glyphOnly?: boolean;
  title?: string;
}

/** Colour is never the only channel: each family also gets its own glyph. */
export function modelFamily(model: string): ModelFamily {
  const id = model.toLowerCase();
  if (id.includes('synthetic')) return 'synthetic';
  if (id.includes('fable')) return 'fable';
  if (id.includes('mythos')) return 'mythos';
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  return 'other';
}

const GLYPH_LABEL: Record<ModelFamily, string> = {
  opus: 'square',
  sonnet: 'circle',
  haiku: 'triangle',
  fable: 'diamond',
  mythos: 'hexagon',
  synthetic: 'dash',
  other: 'ring',
};

function Glyph({ family }: { family: ModelFamily }) {
  const common = { fill: 'currentColor', stroke: 'none' } as const;
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" className={styles.glyph} aria-hidden="true" focusable="false">
      {family === 'opus' ? <rect x="1.2" y="1.2" width="7.6" height="7.6" rx="0.6" {...common} /> : null}
      {family === 'sonnet' ? <circle cx="5" cy="5" r="3.9" {...common} /> : null}
      {family === 'haiku' ? <path d="M5 1 9.2 8.7H0.8Z" {...common} /> : null}
      {family === 'fable' ? <path d="M5 0.7 9.3 5 5 9.3 0.7 5Z" {...common} /> : null}
      {family === 'mythos' ? <path d="M5 0.6 9 2.9v4.2L5 9.4 1 7.1V2.9Z" {...common} /> : null}
      {family === 'other' ? <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" /> : null}
      {family === 'synthetic' ? <path d="M1.2 5h7.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function ModelChip({ model, label, family, size = 'sm', glyphOnly = false, title }: ModelChipProps) {
  const resolved = family ?? modelFamily(model);
  const text = label ?? formatModelLabel(model);
  return (
    <span
      className={[styles.chip, styles[size], glyphOnly ? styles.glyphOnly : null].filter(Boolean).join(' ')}
      data-family={resolved}
      title={title ?? `${text} (${GLYPH_LABEL[resolved]})`}
    >
      <Glyph family={resolved} />
      {glyphOnly ? <span className="visually-hidden">{text}</span> : <span className={styles.text}>{text}</span>}
    </span>
  );
}

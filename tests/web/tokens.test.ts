import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AA_GRAPHICS, AA_TEXT, contrastRatio, parseColor, relativeLuminance } from '../../web/src/design/contrast.js';

const tokensPath = fileURLToPath(new URL('../../web/src/design/tokens.css', import.meta.url));
const css = readFileSync(tokensPath, 'utf8');

type Block = { selector: string; declarations: Map<string, string> };

/** Minimal CSS rule scanner: returns every rule body, including those inside @media. */
function scanBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  let selectorStart = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '{') {
      const selector = source.slice(selectorStart, index).trim();
      let depth = 1;
      let cursor = index + 1;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === '{') depth += 1;
        else if (source[cursor] === '}') depth -= 1;
        cursor += 1;
      }
      const body = source.slice(index + 1, cursor - 1);
      if (selector.startsWith('@')) {
        blocks.push(...scanBlocks(body));
      } else {
        blocks.push({ selector: normalizeSelector(selector), declarations: parseDeclarations(body) });
      }
      index = cursor;
      selectorStart = cursor;
      continue;
    }
    index += 1;
  }
  return blocks;
}

function normalizeSelector(selector: string): string {
  return selector
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .join(', ');
}

function parseDeclarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of body.split(';')) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    if (!name.startsWith('--')) continue;
    map.set(name, line.slice(at + 1).trim());
  }
  return map;
}

const blocks = scanBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''));

function block(selector: string): Map<string, string> {
  const found = blocks.find((b) => b.selector === selector);
  if (!found) throw new Error(`tokens.css is missing a rule for \`${selector}\``);
  return found.declarations;
}

const paper = block(":root, [data-theme='paper']");
const slate = block("[data-theme='slate']");
const systemDark = block("[data-theme='system']");

function value(theme: Map<string, string>, name: string): string {
  const found = theme.get(name);
  if (found === undefined) throw new Error(`token ${name} is not defined in this theme block`);
  return found;
}

const themes: { name: string; tokens: Map<string, string> }[] = [
  { name: 'paper', tokens: paper },
  { name: 'slate', tokens: slate },
];

/** `color-mix(in srgb, fg <pct>, bg)`, the way the row tints in `LedgerTable.module.css` do it. */
function mixSrgb(fg: string, bg: string, fraction: number): string {
  const a = parseColor(fg);
  const b = parseColor(bg);
  const channel = (x: number, y: number): number => Math.round(x * fraction + y * (1 - fraction));
  return `rgb(${channel(a.r, b.r)}, ${channel(a.g, b.g)}, ${channel(a.b, b.b)})`;
}

const modelHues = ['--m-opus', '--m-sonnet', '--m-haiku', '--m-fable', '--m-mythos', '--m-other'];
const statusHues = ['--cost', '--save', '--warn', '--info'];
const tokenClassHues = ['--t-output', '--t-input', '--t-cache-write', '--t-cache-read'];

describe('tokens.css structure', () => {
  it('defines both palettes', () => {
    expect(paper.size).toBeGreaterThan(20);
    expect(slate.size).toBe(paper.size);
  });

  it('keeps the prefers-color-scheme copy identical to [data-theme="slate"]', () => {
    expect([...systemDark.entries()].sort()).toEqual([...slate.entries()].sort());
  });

  it('defines the same token names in both themes', () => {
    expect([...slate.keys()].sort()).toEqual([...paper.keys()].sort());
  });

  it('sets the layout, type and motion tokens once', () => {
    const root = block(':root');
    for (const name of ['--s1', '--s8', '--r1', '--r3', '--font-display', '--font-ui', '--font-mono', '--fs-12', '--fs-56', '--dur', '--elevation']) {
      expect(value(root, name)).toBeTruthy();
    }
  });
});

describe.each(themes)('$name theme contrast', ({ tokens }) => {
  const bg = (name: string): string => value(tokens, name);

  it('ink on paper passes AA', () => {
    expect(contrastRatio(bg('--ink'), bg('--paper'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ink-2 on paper passes AA', () => {
    expect(contrastRatio(bg('--ink-2'), bg('--paper'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ink-3 on paper-2 passes AA', () => {
    expect(contrastRatio(bg('--ink-3'), bg('--paper-2'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ink-3 on paper and paper-3 passes AA', () => {
    expect(contrastRatio(bg('--ink-3'), bg('--paper'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(bg('--ink-3'), bg('--paper-3'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(statusHues)('%s on paper passes AA', (name) => {
    expect(contrastRatio(bg(name), bg('--paper'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(statusHues)('%s on paper-2 passes AA', (name) => {
    expect(contrastRatio(bg(name), bg('--paper-2'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(modelHues)('%s on paper passes AA', (name) => {
    expect(contrastRatio(bg(name), bg('--paper'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(modelHues)('%s on paper-2 passes AA', (name) => {
    expect(contrastRatio(bg(name), bg('--paper-2'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(tokenClassHues)('%s is a legible chart fill on paper (3:1)', (name) => {
    expect(contrastRatio(bg(name), bg('--paper'))).toBeGreaterThanOrEqual(AA_GRAPHICS);
    expect(contrastRatio(bg(name), bg('--paper-2'))).toBeGreaterThanOrEqual(AA_GRAPHICS);
  });

  it('focus ring is visible against every surface (3:1)', () => {
    for (const surface of ['--paper', '--paper-2', '--paper-3']) {
      expect(contrastRatio(bg('--focus'), bg(surface))).toBeGreaterThanOrEqual(AA_GRAPHICS);
    }
  });

  /**
   * A table row is not always drawn on bare paper: hovering mixes 3.5% ink into it and the
   * current row mixes in 10% of `--info`. In the dark theme that *lightens* the row, which cost
   * the tertiary ink its AA margin — the project path and branch under a session title measured
   * 4.47:1 on a hovered row. Both tints are checked here so the palette cannot drift back.
   */
  it('ink-2 and ink-3 stay legible on a hovered and on the current row', () => {
    for (const surface of ['--paper', '--paper-2']) {
      // The two tints `LedgerTable.module.css` paints on a row.
      const hovered = mixSrgb(bg('--ink'), bg(surface), 0.035);
      const current = mixSrgb(bg('--info'), bg(surface), 0.08);
      for (const tint of [hovered, current]) {
        expect(contrastRatio(bg('--ink-2'), tint)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(bg('--ink-3'), tint)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  /** `TreeNav` tints its selected row harder, and only puts `--ink-2` (never `--ink-3`) on it. */
  it('ink-2 stays legible on the selected tree row', () => {
    for (const surface of ['--paper', '--paper-2']) {
      expect(contrastRatio(bg('--ink-2'), mixSrgb(bg('--info'), bg(surface), 0.12))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('the strong hairline is clearly stronger than the default one', () => {
    const strong = contrastRatio(bg('--rule-strong'), bg('--paper'));
    const soft = contrastRatio(bg('--rule'), bg('--paper'));
    expect(strong).toBeGreaterThanOrEqual(2);
    expect(strong).toBeGreaterThan(soft * 1.5);
  });

  /**
   * A heat cell carries meaning on its own, so the *lightest* step still has to be visible as a
   * graphic (1.4.11). Both ramps used to start one step away from the paper they were drawn on
   * (1.16:1 in paper, 1.02:1 in slate), which erased the low-spend end of the strip.
   */
  it('the lightest heat step is a visible cell on every surface (3:1)', () => {
    for (const surface of ['--paper', '--paper-2']) {
      expect(contrastRatio(bg('--heat-0'), bg(surface))).toBeGreaterThanOrEqual(AA_GRAPHICS);
    }
  });

  /**
   * Monotone in hue as well as in luminance: the slate ramp used to swing blue → violet → salmon,
   * which read as four unrelated categories rather than one scale. Every step is now warm, i.e.
   * red above blue, and the ramp only ever gets redder.
   */
  it('every heat step is warm and monotone in hue', () => {
    const steps = ['--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4'].map((name) => parseColor(bg(name)));
    for (const step of steps) {
      expect(step.r).toBeGreaterThan(step.g);
      expect(step.g).toBeGreaterThanOrEqual(step.b);
    }
    for (let i = 1; i < steps.length; i += 1) {
      const previous = steps[i - 1] as { r: number; g: number };
      const current = steps[i] as { r: number; g: number };
      expect(current.r - current.g).toBeGreaterThan(previous.r - previous.g);
    }
  });

  it('heat ramp increases monotonically in luminance distance from paper', () => {
    const base = relativeLuminance(parseColor(bg('--paper')));
    const distances = ['--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4'].map((name) =>
      Math.abs(relativeLuminance(parseColor(bg(name))) - base),
    );
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]).toBeGreaterThan(distances[i - 1] ?? 0);
    }
  });
});

describe('contrast helpers', () => {
  it('matches known reference ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(Math.round(contrastRatio('#767676', '#FFFFFF') * 100) / 100).toBe(4.54);
  });

  it('composites translucent foregrounds over the background', () => {
    expect(contrastRatio('rgba(0, 0, 0, 0)', '#F4EFE6')).toBeCloseTo(1, 5);
    expect(contrastRatio('#0000007F', '#FFFFFF')).toBeGreaterThan(3);
  });

  it('parses shorthand hex and rgb()', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('rgb(23, 21, 15)')).toEqual({ r: 23, g: 21, b: 15, a: 1 });
    expect(parseColor('rgba(23, 21, 15, .14)').a).toBeCloseTo(0.14, 5);
  });

  it('rejects unsupported colors', () => {
    expect(() => parseColor('hsl(200 50% 50%)')).toThrow(/Unsupported color/);
  });
});

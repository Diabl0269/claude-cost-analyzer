/**
 * WCAG 2.x relative luminance and contrast ratio.
 * Pure math, no DOM — imported by tests (node) and by the design gallery.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0–1; 1 when the input had no alpha channel */
  a: number;
}

const HEX_RE = /^#?([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i;

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Throws on anything else. */
export function parseColor(input: string): Rgb {
  const value = input.trim();
  const hex = HEX_RE.exec(value);
  if (hex) {
    const digits = hex[1] ?? '';
    const expand = digits.length === 3 || digits.length === 4;
    const pair = (i: number): number => {
      const slice = expand ? `${digits[i]}${digits[i]}` : digits.slice(i * 2, i * 2 + 2);
      return Number.parseInt(slice, 16);
    };
    if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) {
      throw new Error(`Unsupported hex color: ${input}`);
    }
    const hasAlpha = digits.length === 4 || digits.length === 8;
    return { r: pair(0), g: pair(1), b: pair(2), a: hasAlpha ? pair(3) / 255 : 1 };
  }
  const rgb = RGB_RE.exec(value);
  if (rgb) {
    const alphaRaw = rgb[4];
    const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw);
    return {
      r: Number.parseFloat(rgb[1] ?? '0'),
      g: Number.parseFloat(rgb[2] ?? '0'),
      b: Number.parseFloat(rgb[3] ?? '0'),
      a: Number.isFinite(alpha) ? alpha : 1,
    };
  }
  throw new Error(`Unsupported color: ${input}`);
}

/** Composites a possibly translucent color over an opaque background. */
export function flatten(color: Rgb, background: Rgb): Rgb {
  if (color.a >= 1) return color;
  const mix = (c: number, b: number): number => c * color.a + b * (1 - color.a);
  return { r: mix(color.r, background.r), g: mix(color.g, background.g), b: mix(color.b, background.b), a: 1 };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque color. */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Contrast ratio between two CSS colors (1–21). Translucent foregrounds are composited over the background. */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  if (bg.a < 1) throw new Error(`Background must be opaque: ${background}`);
  const fg = flatten(parseColor(foreground), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_GRAPHICS = 3;

/** Rounded to 2 decimals, the way the tests report it. */
export function ratio2(foreground: string, background: string): number {
  return Math.round(contrastRatio(foreground, background) * 100) / 100;
}

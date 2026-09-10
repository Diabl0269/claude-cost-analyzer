/**
 * Deterministic PRNG for the demo data generator (`core/demo/generate.ts`).
 *
 * mulberry32: 32-bit state, one multiply-xorshift round per draw. It is not cryptographic and is
 * not meant to be — the only requirement is that the same seed replays the same dataset byte for
 * byte on every machine, which a hand-rolled integer generator guarantees and `Math.random` does
 * not.
 */

export type RandomFn = () => number;

/** Classic mulberry32: `seed` is truncated to 32 bits; every draw is in `[0, 1)`. */
export function mulberry32(seed: number): RandomFn {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = '0123456789abcdef';

/** Small convenience layer over `mulberry32`. Every method consumes draws in a fixed order. */
export class Rng {
  private readonly next: RandomFn;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** `[0, 1)` */
  unit(): number {
    return this.next();
  }

  /** Uniform real in `[min, max)`. */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in `[min, max]`. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('Rng.pick on an empty list');
    return item;
  }

  /** Fisher–Yates on a copy, so the input order stays intact. */
  shuffled<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = out[i];
      const b = out[j];
      if (a !== undefined && b !== undefined) {
        out[i] = b;
        out[j] = a;
      }
    }
    return out;
  }

  /** Box–Muller normal draw (one of the pair; the other is discarded). */
  normal(mean: number, sd: number): number {
    const u = Math.max(this.next(), Number.EPSILON);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal draw with the given median, clamped to `[min, max]`. */
  logNormal(median: number, sigma: number, min: number, max: number): number {
    const value = median * Math.exp(this.normal(0, sigma));
    return Math.min(max, Math.max(min, value));
  }

  hex(length: number): string {
    let out = '';
    for (let i = 0; i < length; i += 1) out += HEX[Math.floor(this.next() * 16)];
    return out;
  }

  /** A v4-shaped identifier (version and variant nibbles fixed), used for session and line ids. */
  uuid(): string {
    return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-8${this.hex(3)}-${this.hex(12)}`;
  }
}

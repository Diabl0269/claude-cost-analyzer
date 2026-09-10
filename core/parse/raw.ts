/**
 * The single JSON-parse boundary of the parser. `JSON.parse` is the only place `any` appears in
 * this module; its result is immediately widened to `unknown` and every read goes through one of
 * the narrowing accessors below.
 */

/** Parses JSON, returning `undefined` instead of throwing on malformed input. */
export function parseJson(text: string): unknown {
  try {
    // JSON.parse returns `any`; widen at the boundary so nothing downstream sees it.
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Integer token count; anything else (null, missing, NaN) reads as 0. */
export function count(v: unknown): number {
  const n = asNumber(v);
  return n === undefined ? 0 : Math.round(n);
}

export function rec(o: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  return o ? asRecord(o[key]) : undefined;
}

export function str(o: Record<string, unknown> | undefined, key: string): string | undefined {
  return o ? asString(o[key]) : undefined;
}

export function num(o: Record<string, unknown> | undefined, key: string): number | undefined {
  return o ? asNumber(o[key]) : undefined;
}

export function list(o: Record<string, unknown> | undefined, key: string): unknown[] {
  return (o ? asArray(o[key]) : undefined) ?? [];
}

/** Concatenates the strings in an array with `\n`, ignoring non-strings. */
export function joinStrings(values: unknown[]): string {
  const parts: string[] = [];
  for (const v of values) if (typeof v === 'string') parts.push(v);
  return parts.join('\n');
}

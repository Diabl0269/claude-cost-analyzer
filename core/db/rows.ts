/**
 * Coercion helpers for `node:sqlite` rows and bind parameters.
 * SQLite gives back `string | number | bigint | null | Uint8Array`, and only accepts
 * `null | number | bigint | string | ArrayBufferView` as input — booleans and `undefined` must be
 * converted at the boundary, which is what these helpers are for.
 */
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';

export type Row = Record<string, SQLOutputValue>;

export function str(row: Row, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

export function optStr(row: Row, column: string): string | undefined {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function nullableStr(row: Row, column: string): string | null {
  const value = row[column];
  return typeof value === 'string' ? value : null;
}

export function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

export function optNum(row: Row, column: string): number | undefined {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

export function nullableNum(row: Row, column: string): number | null {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

export function bool(row: Row, column: string): boolean {
  return num(row, column) !== 0;
}

/** `undefined` → null, booleans → 0/1; everything else passes through. */
export function bind(value: string | number | boolean | null | undefined): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** Parses a JSON column, returning `fallback` on any malformed value. */
export function jsonColumn<T>(row: Row, column: string, fallback: T): T {
  const raw = row[column];
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse boundary
    const parsed: any = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

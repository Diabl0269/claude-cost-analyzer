/**
 * Transcript-line access for the store.
 *
 * The index stores `(fileId, byteOffset, byteLength)` per line instead of the line itself, so the
 * transcript view re-reads the original JSONL lazily through `core/jsonl.ts`. This module only adds
 * the read-side tolerance the store needs: a transcript that moved or was truncated while the app
 * was open must render as "unavailable", not throw.
 */
import type { ByteRange } from '../types.js';
import { readLinesAt as readRanges } from '../jsonl.js';

export type LineRange = ByteRange;

/** Reads many ranges from one file; result order matches `ranges`, `null` where unreadable. */
export async function readLinesAt(path: string, ranges: readonly LineRange[]): Promise<(string | null)[]> {
  if (ranges.length === 0) return [];
  try {
    const lines = await readRanges(path, [...ranges]);
    return ranges.map((_, i) => {
      const line = lines[i];
      return line === undefined || line.length === 0 ? null : line.replace(/\r?\n$/, '');
    });
  } catch {
    return ranges.map(() => null);
  }
}

/** Reads one line. Returns `null` when the file moved or the range is past EOF. */
export async function readLineAt(path: string, range: LineRange): Promise<string | null> {
  const [line] = await readLinesAt(path, [range]);
  return line ?? null;
}

/**
 * Parses a transcript line. Returns `null` for malformed JSON rather than throwing: a truncated
 * or half-written line must not break the transcript view.
 */
export function parseLine(line: string | null): Record<string, unknown> | null {
  if (!line) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse boundary
    const parsed: any = JSON.parse(line);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

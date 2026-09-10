/**
 * Streaming JSONL reader with exact byte offsets.
 *
 * Transcripts reach 20+ MB, so nothing here ever holds a whole file in memory: `readJsonlLines`
 * yields one line at a time and keeps at most one partial line buffered. The `(byteOffset,
 * byteLength)` pair of a yielded line addresses exactly the bytes of `text` — the terminating
 * `\n` (and a preceding `\r`) are excluded — so `readLineAt(path, line)` returns the identical
 * string without re-reading the file.
 */
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import type { ByteRange } from './types.js';

const LF = 0x0a;
const CR = 0x0d;

/** 256 KB chunks: large enough to amortize syscalls, small enough to stay off the large-object path. */
const CHUNK_SIZE = 256 * 1024;

export interface JsonlLine extends ByteRange {
  /** 0-based index of this line within the file (blank lines included) */
  seq: number;
  /** the line without its terminator; `Buffer.byteLength(text) === byteLength` */
  text: string;
}

/**
 * Yields every line of `path` in file order. Handles LF and CRLF terminators and a final line
 * without a terminator. A trailing empty segment after the last `\n` is not emitted; blank lines
 * in the middle of the file are, so `seq` always equals the physical line index.
 */
export async function* readJsonlLines(path: string): AsyncGenerator<JsonlLine> {
  const stream = createReadStream(path, { highWaterMark: CHUNK_SIZE });
  let pending: Buffer = Buffer.alloc(0);
  /** absolute byte offset of pending[0] */
  let pendingOffset = 0;
  let seq = 0;

  for await (const chunk of stream) {
    const buf: Buffer = chunk as Buffer;
    pending = pending.length === 0 ? buf : Buffer.concat([pending, buf]);
    let start = 0;
    for (;;) {
      const nl = pending.indexOf(LF, start);
      if (nl === -1) break;
      let end = nl;
      if (end > start && pending[end - 1] === CR) end -= 1;
      yield {
        seq: seq++,
        byteOffset: pendingOffset + start,
        byteLength: end - start,
        text: pending.toString('utf8', start, end),
      };
      start = nl + 1;
    }
    if (start > 0) {
      pendingOffset += start;
      pending = pending.subarray(start);
    }
  }

  if (pending.length > 0) {
    let end = pending.length;
    if (end > 0 && pending[end - 1] === CR) end -= 1;
    yield {
      seq: seq++,
      byteOffset: pendingOffset,
      byteLength: end,
      text: pending.toString('utf8', 0, end),
    };
  }
}

/** Re-reads one line addressed by a `ByteRange` produced by `readJsonlLines`. */
export async function readLineAt(path: string, range: ByteRange): Promise<string> {
  const [line] = await readLinesAt(path, [range]);
  return line ?? '';
}

/**
 * Batch form of `readLineAt`: opens the file once and reads the ranges in ascending offset order
 * (for locality), returning the decoded lines in the order the ranges were given.
 */
export async function readLinesAt(path: string, ranges: ByteRange[]): Promise<string[]> {
  const out = new Array<string>(ranges.length).fill('');
  if (ranges.length === 0) return out;
  const order = ranges.map((_, i) => i).sort((a, b) => {
    const ra = ranges[a];
    const rb = ranges[b];
    return (ra ? ra.byteOffset : 0) - (rb ? rb.byteOffset : 0);
  });
  const handle = await open(path, 'r');
  try {
    for (const i of order) {
      const range = ranges[i];
      if (!range || range.byteLength <= 0) continue;
      const buf = Buffer.allocUnsafe(range.byteLength);
      const { bytesRead } = await handle.read(buf, 0, range.byteLength, range.byteOffset);
      out[i] = buf.toString('utf8', 0, bytesRead);
    }
  } finally {
    await handle.close();
  }
  return out;
}

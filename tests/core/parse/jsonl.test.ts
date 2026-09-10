import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readJsonlLines, readLineAt, readLinesAt } from '../../../core/jsonl.js';

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function write(name: string, body: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cca-jsonl-'));
  dirs.push(dir);
  const p = path.join(dir, name);
  await writeFile(p, body);
  return p;
}

async function collect(p: string) {
  const out = [];
  for await (const line of readJsonlLines(p)) out.push(line);
  return out;
}

describe('readJsonlLines', () => {
  it('yields LF-terminated lines with exact offsets that round-trip', async () => {
    const texts = ['{"a":1}', '{"b":"héllo ✓"}', '{"c":[1,2,3]}'];
    const p = await write('lf.jsonl', texts.join('\n') + '\n');
    const lines = await collect(p);
    expect(lines.map((l) => l.text)).toEqual(texts);
    expect(lines.map((l) => l.seq)).toEqual([0, 1, 2]);
    for (const line of lines) {
      expect(line.byteLength).toBe(Buffer.byteLength(line.text));
      expect(await readLineAt(p, line)).toBe(line.text);
    }
    expect(lines[1]!.byteOffset).toBe(Buffer.byteLength(texts[0]!) + 1);
  });

  it('strips CRLF terminators from both text and byteLength', async () => {
    const texts = ['{"a":1}', '{"b":2}'];
    const p = await write('crlf.jsonl', texts.join('\r\n') + '\r\n');
    const lines = await collect(p);
    expect(lines.map((l) => l.text)).toEqual(texts);
    for (const line of lines) expect(await readLineAt(p, line)).toBe(line.text);
    expect(lines[1]!.byteOffset).toBe(Buffer.byteLength(texts[0]!) + 2);
  });

  it('emits a final line without a terminator and keeps blank lines in the middle', async () => {
    const p = await write('mixed.jsonl', '{"a":1}\n\n{"b":2}');
    const lines = await collect(p);
    expect(lines.map((l) => l.text)).toEqual(['{"a":1}', '', '{"b":2}']);
    expect(lines.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(await readLineAt(p, lines[2]!)).toBe('{"b":2}');
  });

  it('does not emit a phantom empty line after the last terminator', async () => {
    const p = await write('trailing.jsonl', '{"a":1}\n');
    expect((await collect(p)).length).toBe(1);
  });

  it('yields nothing for an empty file', async () => {
    const p = await write('empty.jsonl', '');
    expect(await collect(p)).toEqual([]);
  });

  it('reads a 21 MB file by streaming, with offsets that still round-trip', async () => {
    const payload = 'x'.repeat(20_000);
    const count = 1_150; // ~23 MB
    const body = Array.from({ length: count }, (_, i) => JSON.stringify({ i, payload })).join('\n') + '\n';
    expect(Buffer.byteLength(body)).toBeGreaterThan(21 * 1024 * 1024);
    const p = await write('big.jsonl', body);

    let seen = 0;
    let last = { byteOffset: 0, byteLength: 0, text: '' };
    for await (const line of readJsonlLines(p)) {
      seen += 1;
      last = line;
    }
    expect(seen).toBe(count);
    expect(await readLineAt(p, last)).toBe(last.text);
    expect(last.byteOffset + last.byteLength + 1).toBe(Buffer.byteLength(body));
  });
});

describe('readLinesAt', () => {
  it('returns lines in the order requested, not in offset order', async () => {
    const texts = ['{"a":1}', '{"b":2}', '{"c":3}'];
    const p = await write('batch.jsonl', texts.join('\n') + '\n');
    const lines = await collect(p);
    const got = await readLinesAt(p, [lines[2]!, lines[0]!, lines[1]!]);
    expect(got).toEqual([texts[2], texts[0], texts[1]]);
  });

  it('returns an empty array for no ranges and an empty string for a zero-length range', async () => {
    const p = await write('edge.jsonl', '{"a":1}\n');
    expect(await readLinesAt(p, [])).toEqual([]);
    expect(await readLinesAt(p, [{ byteOffset: 0, byteLength: 0 }])).toEqual(['']);
  });
});

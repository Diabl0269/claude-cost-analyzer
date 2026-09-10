import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiscoveredFile, TranscriptKind } from '../../../core/types.js';

export const FIXTURE_ROOT = fileURLToPath(new URL('../../fixtures/projects', import.meta.url));
export const LEGACY_ROOT = fileURLToPath(new URL('../../fixtures/legacy-projects', import.meta.url));

export const ALPHA_DIR = path.join(FIXTURE_ROOT, '-Users-dev-projects-alpha');
export const A1 = 'a1111111-1111-4111-8111-111111111111';
export const A2 = 'a2222222-2222-4222-8222-222222222222';
export const A3 = 'a3333333-3333-4333-8333-333333333333';

export function fixtureFile(sessionId: string): DiscoveredFile {
  return {
    path: path.join(ALPHA_DIR, `${sessionId}.jsonl`),
    size: 0,
    mtimeMs: 0,
    kind: 'main',
    projectDirName: '-Users-dev-projects-alpha',
    sessionId,
  };
}

const scratchDirs: string[] = [];

/** Writes JSONL lines to a throwaway file and returns a `DiscoveredFile` pointing at it. */
export async function tempTranscript(
  lines: (object | string)[],
  opts: { kind?: TranscriptKind; agentId?: string; eol?: string; trailingNewline?: boolean } = {},
): Promise<DiscoveredFile> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cca-parse-'));
  scratchDirs.push(dir);
  const filePath = path.join(dir, 'transcript.jsonl');
  const eol = opts.eol ?? '\n';
  const body = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join(eol);
  await writeFile(filePath, body + (opts.trailingNewline === false ? '' : eol));
  const file: DiscoveredFile = {
    path: filePath,
    size: 0,
    mtimeMs: 0,
    kind: opts.kind ?? 'main',
    projectDirName: 'temp',
    sessionId: 'temp-session',
  };
  if (opts.agentId) file.agentId = opts.agentId;
  return file;
}

export async function cleanupScratch(): Promise<void> {
  await Promise.all(scratchDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

interface UsageInput {
  input?: number;
  c5?: number;
  c1?: number;
  read?: number;
  output?: number;
  thinking?: number;
}

/** Minimal but realistically-shaped `message.usage`. */
export function usage(u: UsageInput = {}): Record<string, unknown> {
  const c5 = u.c5 ?? 0;
  const c1 = u.c1 ?? 0;
  return {
    input_tokens: u.input ?? 0,
    cache_creation_input_tokens: c5 + c1,
    cache_read_input_tokens: u.read ?? 0,
    output_tokens: u.output ?? 0,
    output_tokens_details: { thinking_tokens: u.thinking ?? 0 },
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
    cache_creation: { ephemeral_5m_input_tokens: c5, ephemeral_1h_input_tokens: c1 },
    inference_geo: 'global',
    speed: 'standard',
  };
}

let uuidCounter = 0;
export const nextUuid = (): string => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;

export function assistantLine(fields: {
  id: string;
  model: string;
  content: unknown[];
  usage: Record<string, unknown>;
  ts?: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: nextUuid(),
    parentUuid: null,
    timestamp: fields.ts ?? '2026-09-01T09:00:00.000Z',
    requestId: `req_${fields.id}`,
    sessionId: 'temp-session',
    cwd: '/tmp/alpha',
    message: {
      id: fields.id,
      type: 'message',
      role: 'assistant',
      model: fields.model,
      content: fields.content,
      stop_reason: 'end_turn',
      usage: fields.usage,
    },
    ...fields.extra,
  };
}

export function userLine(content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'user',
    uuid: nextUuid(),
    parentUuid: null,
    timestamp: '2026-09-01T09:00:00.000Z',
    sessionId: 'temp-session',
    cwd: '/tmp/alpha',
    message: { role: 'user', content },
    ...extra,
  };
}

/**
 * Synthetic on-disk session used by the db tests: a real JSONL file (so byte-range reads work)
 * plus the ParsedSession a parser would produce for it. No real transcript content is involved.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ByteRange, DiscoveredSession, ParsedSession, ParsedTranscript } from '../../../core/types.js';
import {
  CWD,
  PROJECT_DIR,
  SESSION_ID,
  block,
  compaction,
  file,
  injection,
  message,
  request,
  toolCall,
  transcript,
  usage,
} from '../cost/builders.js';

export const AGENT_ID = 'agent-abc123';
export const TS = (minute: number): string => `2026-09-07T09:${String(minute).padStart(2, '0')}:00.000Z`;

/** Writes lines as JSONL and returns the byte range of each line (excluding the newline). */
function writeJsonl(path: string, lines: readonly unknown[]): ByteRange[] {
  mkdirSync(dirname(path), { recursive: true });
  const ranges: ByteRange[] = [];
  let offset = 0;
  const chunks: string[] = [];
  for (const line of lines) {
    const text = JSON.stringify(line);
    const byteLength = Buffer.byteLength(text, 'utf8');
    ranges.push({ byteOffset: offset, byteLength });
    offset += byteLength + 1;
    chunks.push(text);
  }
  writeFileSync(path, `${chunks.join('\n')}\n`, 'utf8');
  return ranges;
}

export interface Fixture {
  root: string;
  mainPath: string;
  agentPath: string;
  session: ParsedSession;
  discovered: DiscoveredSession;
}

const MAIN_LINES: unknown[] = [
  { type: 'user', message: { role: 'user', content: 'Rename the helper in utils.ts' } },
  {
    type: 'assistant',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5',
      content: [
        { type: 'text', text: 'Reading the file first.' },
        { type: 'tool_use', id: 'toolu_a', name: 'Read', input: { file_path: 'utils.ts' } },
      ],
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'export function helper() {}' }] },
  },
  { type: 'attachment', attachment: { type: 'total_tokens_reminder' }, rendered: [{ content: 'Token budget reminder.' }] },
  {
    type: 'assistant',
    message: {
      id: 'msg_4',
      model: 'claude-opus-5',
      content: [
        { type: 'text', text: 'Delegating the rename.' },
        { type: 'tool_use', id: 'toolu_b', name: 'Agent', input: { description: 'rename helper' } },
      ],
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'renamed' }] },
  },
  {
    type: 'assistant',
    message: { id: 'msg_6', model: 'claude-opus-5', content: [{ type: 'text', text: 'Renamed the helper in utils.ts.' }] },
  },
  { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 40_000, postTokens: 4_000 } },
];

const AGENT_LINES: unknown[] = [
  { type: 'user', message: { role: 'user', content: 'Rename helper to renameHelper' } },
  {
    type: 'assistant',
    message: { id: 'msg_a1', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'Done.' }] },
  },
];

function mainTranscript(path: string, ranges: ByteRange[], mtimeMs: number): ParsedTranscript {
  const at = (i: number): ByteRange => ranges[i] ?? { byteOffset: 0, byteLength: 0 };
  return transcript({
    file: file({ path, mtimeMs, size: 4096 }),
    meta: {
      cwd: CWD,
      gitBranch: 'main',
      version: '2.1.263',
      entrypoint: 'cli',
      effort: 'high',
      firstTs: TS(0),
      lastTs: TS(9),
      lineCount: MAIN_LINES.length,
      parseErrors: 0,
    },
    promptCount: 1,
    requests: [
      request({
        seq: 1,
        ts: TS(1),
        usage: usage({ input: 1000, output: 500, thinking: 100 }),
        contextTokens: 1000,
        lines: [at(1)],
        blocks: [
          block({ type: 'text', chars: 23 }),
          block({ type: 'tool_use', chars: 40, toolUseId: 'toolu_a', toolName: 'Read' }),
        ],
        attribution: { skill: 'code-review' },
      }),
      request({
        seq: 4,
        ts: TS(4),
        usage: usage({ input: 100, output: 300, cache5m: 2000, cacheRead: 1000 }),
        contextTokens: 3100,
        lines: [at(4)],
        blocks: [
          block({ type: 'text', chars: 22 }),
          block({ type: 'tool_use', chars: 38, toolUseId: 'toolu_b', toolName: 'Agent' }),
        ],
      }),
      request({
        seq: 6,
        ts: TS(6),
        usage: usage({ input: 50, output: 200, cacheRead: 4000 }),
        contextTokens: 4050,
        lines: [at(6)],
        blocks: [block({ type: 'text', chars: 31 })],
      }),
    ],
    toolCalls: [
      toolCall({
        toolUseId: 'toolu_a',
        requestSeq: 1,
        resultSeq: 2,
        ts: TS(1),
        name: 'Read',
        resultChars: 620,
        inputSummary: 'utils.ts',
      }),
      toolCall({
        toolUseId: 'toolu_b',
        requestSeq: 4,
        resultSeq: 5,
        ts: TS(4),
        name: 'Agent',
        resultChars: 200,
        inputSummary: 'rename helper',
        childAgentId: AGENT_ID,
        childModel: 'haiku',
        childDescription: 'rename helper',
      }),
    ],
    injections: [
      injection({ seq: 0, kind: 'user_prompt', name: 'prompt', chars: 29, charsSource: 'content' }),
      injection({ seq: 3, kind: 'attachment', name: 'total_tokens_reminder', chars: 22 }),
    ],
    compactions: [compaction({ seq: 7, ts: TS(9) })],
    messages: [
      message({ seq: 0, ts: TS(0), kind: 'prompt', range: at(0), searchText: 'Rename the helper in utils.ts', preview: 'Rename the helper in utils.ts' }),
      message({
        seq: 1,
        ts: TS(1),
        role: 'assistant',
        kind: 'assistant',
        messageId: 'msg_1',
        requestSeq: 1,
        range: at(1),
        searchText: 'Reading the file first. Read utils.ts',
        preview: 'Reading the file first.',
      }),
      message({ seq: 2, ts: TS(2), kind: 'tool_result', range: at(2), searchText: 'export function helper', preview: 'export function helper() {}' }),
      message({ seq: 3, ts: TS(3), role: 'attachment', kind: 'attachment', subtype: 'total_tokens_reminder', range: at(3), searchText: 'Token budget reminder.', preview: 'Token budget reminder.', isMeta: true }),
      message({
        seq: 4,
        ts: TS(4),
        role: 'assistant',
        kind: 'assistant',
        messageId: 'msg_4',
        requestSeq: 4,
        range: at(4),
        searchText: 'Delegating the rename. Agent rename helper',
        preview: 'Delegating the rename.',
      }),
      message({ seq: 5, ts: TS(5), kind: 'tool_result', range: at(5), searchText: 'renamed', preview: 'renamed' }),
      message({
        seq: 6,
        ts: TS(6),
        role: 'assistant',
        kind: 'assistant',
        messageId: 'msg_6',
        requestSeq: 6,
        range: at(6),
        searchText: 'Renamed the helper in utils.ts.',
        preview: 'Renamed the helper in utils.ts.',
      }),
      message({ seq: 7, ts: TS(9), role: 'system', kind: 'system', subtype: 'compact_boundary', range: at(7), searchText: '', preview: '' }),
    ],
    facts: {
      firstPrompt: 'Rename the helper in utils.ts',
      aiTitle: 'Rename helper in utils',
      prLinks: [],
      localCommands: ['/review'],
      queuedOperations: 0,
      turnDurationsMs: [42_000],
      awaySummaries: 0,
      reportedCost: { totalCostUSD: 0.05, modelUsage: {} },
    },
  });
}

function agentTranscript(path: string, ranges: ByteRange[], mtimeMs: number): ParsedTranscript {
  const at = (i: number): ByteRange => ranges[i] ?? { byteOffset: 0, byteLength: 0 };
  return transcript({
    file: file({ path, mtimeMs, size: 512, kind: 'subagent', agentId: AGENT_ID }),
    agentId: AGENT_ID,
    meta: { cwd: CWD, firstTs: TS(4), lastTs: TS(5), lineCount: AGENT_LINES.length, parseErrors: 0 },
    promptCount: 0,
    requests: [
      request({
        seq: 1,
        ts: TS(5),
        model: 'claude-haiku-4-5-20251001',
        usage: usage({ input: 6735, output: 18 }),
        contextTokens: 6735,
        lines: [at(1)],
        blocks: [block({ type: 'text', chars: 5 })],
      }),
    ],
    messages: [
      message({ seq: 0, ts: TS(4), kind: 'prompt', range: at(0), searchText: 'Rename helper to renameHelper', preview: 'Rename helper to renameHelper' }),
      message({
        seq: 1,
        ts: TS(5),
        role: 'assistant',
        kind: 'assistant',
        messageId: 'msg_a1',
        requestSeq: 1,
        range: at(1),
        searchText: 'Done.',
        preview: 'Done.',
      }),
    ],
  });
}

export interface FixtureOptions {
  /** lets a test simulate an edited file */
  mtimeMs?: number;
  /** second session in the same project, for paging and sorting tests */
  sessionId?: string;
  /** local start date of the session (defaults to the day the transcript timestamps use) */
  date?: string;
}

/** Creates the fixture under `root`. */
export function buildFixture(root: string, options: number | FixtureOptions = {}): Fixture {
  const opts: FixtureOptions = typeof options === 'number' ? { mtimeMs: options } : options;
  const mtimeMs = opts.mtimeMs ?? 1_757_000_000_000;
  const sessionId = opts.sessionId ?? SESSION_ID;
  const projectDir = join(root, PROJECT_DIR);
  const mainPath = join(projectDir, `${sessionId}.jsonl`);
  const agentPath = join(projectDir, sessionId, 'subagents', `agent-${AGENT_ID}.jsonl`);
  const mainRanges = writeJsonl(mainPath, MAIN_LINES);
  const agentRanges = writeJsonl(agentPath, AGENT_LINES);

  const main = mainTranscript(mainPath, mainRanges, mtimeMs);
  const agent = agentTranscript(agentPath, agentRanges, mtimeMs);
  main.file.sessionId = sessionId;
  agent.file.sessionId = sessionId;
  if (opts.date) {
    main.meta.firstTs = `${opts.date}T09:00:00.000Z`;
    main.meta.lastTs = `${opts.date}T09:09:00.000Z`;
  }
  const discovered: DiscoveredSession = {
    projectDirName: PROJECT_DIR,
    projectDirPath: projectDir,
    sessionId,
    mainFile: main.file,
    agentFiles: [agent.file],
    workflowRuns: [],
  };
  const session: ParsedSession = {
    discovered,
    main,
    agents: [agent],
    agentMeta: {
      [AGENT_ID]: { agentType: 'general-purpose', description: 'rename helper', toolUseId: 'toolu_b', model: 'haiku', spawnDepth: 1 },
    },
    workflowRuns: [],
  };
  return { root, mainPath, agentPath, session, discovered };
}

/** Costs computed by hand from the fixture usage at default Opus 5 / Haiku 4.5 list prices. */
export const EXPECTED = {
  /** 1000·$5 + 500·$25 per MTok */
  request1: (1000 * 5 + 500 * 25) / 1e6,
  /** 100·$5 + 300·$25 + 2000·$6.25 + 1000·$0.5 */
  request4: (100 * 5 + 300 * 25 + 2000 * 6.25 + 1000 * 0.5) / 1e6,
  /** 50·$5 + 200·$25 + 4000·$0.5 */
  request6: (50 * 5 + 200 * 25 + 4000 * 0.5) / 1e6,
  /** 6735·$1 + 18·$5 */
  agent: (6735 * 1 + 18 * 5) / 1e6,
};
export const EXPECTED_MAIN = EXPECTED.request1 + EXPECTED.request4 + EXPECTED.request6;
export const EXPECTED_TOTAL = EXPECTED_MAIN + EXPECTED.agent;

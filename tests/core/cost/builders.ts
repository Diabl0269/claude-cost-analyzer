/**
 * Hand-built parser output for cost/attribution/db tests.
 * Nothing here touches the real parser or ~/.claude; every value is synthetic.
 */
import type {
  DiscoveredFile,
  DiscoveredSession,
  ParsedBlock,
  ParsedCompaction,
  ParsedInjection,
  ParsedMessage,
  ParsedRequest,
  ParsedSession,
  ParsedToolCall,
  ParsedTranscript,
  TokenUsage,
} from '../../../core/types.js';

export const SESSION_ID = '11111111-2222-3333-4444-555555555555';
export const PROJECT_DIR = '-Users-dev-widget';
export const CWD = '/Users/dev/widget';

export function usage(partial: Partial<TokenUsage> = {}): TokenUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cache5m: 0,
    cache1h: 0,
    thinking: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    ...partial,
  };
}

let clock = Date.UTC(2026, 8, 7, 9, 0, 0);
export function nextTs(stepMs = 30_000): string {
  clock += stepMs;
  return new Date(clock).toISOString();
}

export function resetClock(): void {
  clock = Date.UTC(2026, 8, 7, 9, 0, 0);
}

export function request(partial: Partial<ParsedRequest> & { seq: number }): ParsedRequest {
  const u = partial.usage ?? usage();
  return {
    turnIndex: 0,
    messageId: `msg_${partial.seq}`,
    uuid: `uuid_${partial.seq}`,
    ts: nextTs(),
    model: 'claude-opus-5',
    speed: 'standard',
    serviceTier: 'standard',
    inferenceGeo: 'global',
    blocks: [],
    isSynthetic: false,
    isApiError: false,
    isAbortedMidStream: false,
    isFallback: false,
    attribution: {},
    lines: [{ byteOffset: 0, byteLength: 10 }],
    contextTokens: u.input + u.cacheRead + u.cache5m + u.cache1h,
    ...partial,
    usage: u,
  };
}

export function block(partial: Partial<ParsedBlock> & { type: ParsedBlock['type'] }): ParsedBlock {
  return { chars: 0, ...partial };
}

export function toolCall(partial: Partial<ParsedToolCall> & { toolUseId: string; requestSeq: number }): ParsedToolCall {
  return {
    name: 'Read',
    turnIndex: 0,
    ts: nextTs(0),
    inputChars: 40,
    inputSummary: 'read src/index.ts',
    resultChars: 0,
    resultImages: 0,
    resultShape: 'string',
    isError: false,
    resultPreview: '',
    ...partial,
  };
}

export function injection(partial: Partial<ParsedInjection> & { seq: number }): ParsedInjection {
  return {
    turnIndex: 0,
    kind: 'attachment',
    name: 'total_tokens_reminder',
    chars: 100,
    charsSource: 'rendered',
    ...partial,
  };
}

export function compaction(partial: Partial<ParsedCompaction> & { seq: number }): ParsedCompaction {
  return { turnIndex: 0, trigger: 'auto', preTokens: 150_000, postTokens: 20_000, ...partial };
}

export function message(partial: Partial<ParsedMessage> & { seq: number }): ParsedMessage {
  return {
    turnIndex: 0,
    uuid: `m_${partial.seq}`,
    role: 'user',
    kind: 'prompt',
    range: { byteOffset: 0, byteLength: 0 },
    searchText: '',
    preview: '',
    isMeta: false,
    isSidechain: false,
    ...partial,
  };
}

export function file(partial: Partial<DiscoveredFile> = {}): DiscoveredFile {
  return {
    path: `/tmp/cca-test/${PROJECT_DIR}/${SESSION_ID}.jsonl`,
    size: 1024,
    mtimeMs: 1_757_000_000_000,
    kind: 'main',
    projectDirName: PROJECT_DIR,
    sessionId: SESSION_ID,
    ...partial,
  };
}

export function transcript(partial: Partial<ParsedTranscript> = {}): ParsedTranscript {
  return {
    file: file(),
    agentId: null,
    meta: {
      cwd: CWD,
      gitBranch: 'main',
      version: '2.1.263',
      entrypoint: 'cli',
      firstTs: '2026-09-07T09:00:00.000Z',
      lastTs: '2026-09-07T09:30:00.000Z',
      lineCount: 20,
      parseErrors: 0,
    },
    requests: [],
    messages: [],
    toolCalls: [],
    injections: [],
    hooks: [],
    compactions: [],
    apiErrors: [],
    promptCount: 1,
    ...partial,
  };
}

export function discoveredSession(main: DiscoveredFile, agents: DiscoveredFile[] = []): DiscoveredSession {
  return {
    projectDirName: PROJECT_DIR,
    projectDirPath: `/tmp/cca-test/${PROJECT_DIR}`,
    sessionId: SESSION_ID,
    mainFile: main,
    agentFiles: agents,
    workflowRuns: [],
  };
}

export function parsedSession(partial: Partial<ParsedSession> = {}): ParsedSession {
  const main = partial.main ?? transcript();
  return {
    discovered: discoveredSession(main.file, (partial.agents ?? []).map((a) => a.file)),
    main,
    agents: [],
    agentMeta: {},
    workflowRuns: [],
    ...partial,
  };
}

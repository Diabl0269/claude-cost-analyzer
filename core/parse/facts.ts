/**
 * Session-level facts: the small typed line kinds (`ai-title`, `pr-link`, `cost-state`, …) that
 * carry no cost and no searchable text but say something about the session (SPEC §3.2, §4).
 *
 * Only main transcripts collect these; subagent files inherit their session's facts.
 */
import type { ReportedCost, ReportedModelUsage, SessionFacts } from '../types.js';
import { asRecord, count, num, rec, str } from './raw.js';

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/gi;

/** `<command-name>` values inside a `local_command` system line. */
export function commandNamesOf(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(COMMAND_NAME)) {
    const name = m[1]?.trim();
    if (name) out.push(name);
  }
  return out;
}

/** Folds one fact line into the accumulating `SessionFacts`. Last value wins for scalars. */
export function applyFact(facts: SessionFacts, type: string, obj: Record<string, unknown>): void {
  switch (type) {
    case 'ai-title':
      assign(obj, 'aiTitle', (v) => (facts.aiTitle = v));
      return;
    case 'custom-title':
      assign(obj, 'customTitle', (v) => (facts.customTitle = v));
      return;
    case 'agent-name':
      assign(obj, 'agentName', (v) => (facts.agentName = v));
      return;
    case 'cost-state':
      facts.reportedCost = readReportedCost(obj);
      return;
    case 'pr-link': {
      const url = str(obj, 'prUrl');
      if (!url) return;
      const link: SessionFacts['prLinks'][number] = { url };
      const number = num(obj, 'prNumber');
      const repository = str(obj, 'prRepository');
      const ts = str(obj, 'timestamp');
      if (number !== undefined) link.number = number;
      if (repository) link.repository = repository;
      if (ts) link.ts = ts;
      facts.prLinks.push(link);
      return;
    }
    case 'continued-in':
      assign(obj, 'continuedInSessionId', (v) => (facts.continuedInSessionId = v));
      return;
    case 'relocated':
      assign(obj, 'relocatedCwd', (v) => (facts.relocatedCwd = v));
      return;
    case 'mode':
      assign(obj, 'mode', (v) => (facts.mode = v));
      return;
    case 'permission-mode':
      assign(obj, 'permissionMode', (v) => (facts.permissionMode = v));
      return;
    case 'queue-operation':
      facts.queuedOperations += 1;
      return;
    default:
      return;
  }
}

function assign(obj: Record<string, unknown>, key: string, set: (value: string) => void): void {
  const value = str(obj, key);
  if (value) set(value);
}

/**
 * Claude Code's own running tally. Model keys are kept exactly as written, `[1m]` suffix and all —
 * stripping happens at price-match time, not here.
 */
export function readReportedCost(obj: Record<string, unknown>): ReportedCost {
  const modelUsage: Record<string, ReportedModelUsage> = {};
  const raw = rec(obj, 'modelUsage');
  for (const [model, value] of Object.entries(raw ?? {})) {
    const entry = asRecord(value);
    if (!entry) continue;
    const usage: ReportedModelUsage = {
      inputTokens: count(entry['inputTokens']),
      outputTokens: count(entry['outputTokens']),
      cacheReadInputTokens: count(entry['cacheReadInputTokens']),
      cacheCreationInputTokens: count(entry['cacheCreationInputTokens']),
      costUSD: num(entry, 'costUSD') ?? 0,
    };
    const thinking = num(entry, 'thinkingTokens');
    const webSearch = num(entry, 'webSearchRequests');
    if (thinking !== undefined) usage.thinkingTokens = thinking;
    if (webSearch !== undefined) usage.webSearchRequests = webSearch;
    modelUsage[model] = usage;
  }
  const reported: ReportedCost = { totalCostUSD: num(obj, 'totalCostUSD') ?? 0, modelUsage };
  const apiDurationMs = num(obj, 'totalAPIDuration');
  const durationMs = num(obj, 'totalDuration');
  const toolDurationMs = num(obj, 'totalToolDuration');
  const linesAdded = num(obj, 'totalLinesAdded');
  const linesRemoved = num(obj, 'totalLinesRemoved');
  if (apiDurationMs !== undefined) reported.totalAPIDurationMs = apiDurationMs;
  if (durationMs !== undefined) reported.totalDurationMs = durationMs;
  if (toolDurationMs !== undefined) reported.totalToolDurationMs = toolDurationMs;
  if (linesAdded !== undefined) reported.totalLinesAdded = linesAdded;
  if (linesRemoved !== undefined) reported.totalLinesRemoved = linesRemoved;
  if (obj['hasUnknownModelCost'] === true) reported.hasUnknownModelCost = true;
  return reported;
}

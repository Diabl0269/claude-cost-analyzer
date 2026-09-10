/**
 * Tool-call helpers: name splitting for MCP tools, the input-summary heuristics of SPEC §3.5, and
 * the child links (`Agent` → subagent transcript, `Workflow` → run directory) carried by
 * `toolUseResult`.
 */
import { safeStringify } from './blocks.js';
import { asRecord, num, str } from './raw.js';

const MCP_NAME = /^mcp__([^_](?:.*?))__(.+)$/;

const MAX_SUMMARY_CHARS = 160;

export interface McpName {
  mcpServer?: string;
  mcpTool?: string;
}

/** `mcp__<server>__<tool>` → its two halves; `{}` for every other tool name. */
export function splitMcpName(name: string): McpName {
  const m = MCP_NAME.exec(name);
  if (!m?.[1] || !m[2]) return {};
  return { mcpServer: m[1], mcpTool: m[2] };
}

/** Per-tool "what did this call do" line, capped at 160 characters. */
export function summarizeToolInput(name: string, input: unknown): string {
  const obj = asRecord(input);
  const pick = (key: string): string | undefined => str(obj, key)?.trim() || undefined;
  let summary: string | undefined;
  switch (name) {
    case 'Bash':
      summary = pick('command');
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      summary = pick('file_path');
      break;
    case 'Agent':
      summary = pick('description');
      break;
    case 'Skill':
      summary = pick('skill');
      break;
    case 'WebFetch':
      summary = pick('url');
      break;
    default:
      break;
  }
  if (!summary && name.startsWith('mcp__') && obj) {
    for (const value of Object.values(obj)) {
      if (typeof value === 'string' && value.trim()) {
        summary = value.trim();
        break;
      }
    }
  }
  if (!summary) summary = safeStringify(input);
  return summary.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS);
}

export interface ToolChildLinks {
  childAgentId?: string;
  childRunId?: string;
  childModel?: string;
  childDescription?: string;
  persistedOutputPath?: string;
  durationMs?: number;
}

/**
 * Reads the structured `toolUseResult` of the answering `user` line. Sync Agent results carry
 * `agentId` + `agentType`; async launches carry `agentId` + `resolvedModel`; Workflow carries
 * `runId`.
 *
 * `childModel` / `childDescription` fall back to the tool input only for the `Agent` tool: plenty
 * of other tools (Bash, for one) have their own `description` field that means something else.
 */
export function readToolUseResult(name: string, toolUseResult: unknown, input: unknown): ToolChildLinks {
  const result = asRecord(toolUseResult);
  const inputObj = name === 'Agent' ? asRecord(input) : undefined;
  const out: ToolChildLinks = {};
  const agentId = str(result, 'agentId');
  const runId = str(result, 'runId');
  const model = str(result, 'resolvedModel') ?? str(inputObj, 'model');
  const description = str(result, 'description') ?? str(inputObj, 'description');
  const persisted = str(result, 'persistedOutputPath');
  const durationMs = num(result, 'durationMs') ?? num(result, 'totalDurationMs');
  const durationSeconds = num(result, 'durationSeconds');
  if (agentId) out.childAgentId = agentId;
  if (runId) out.childRunId = runId;
  if (model) out.childModel = model;
  if (description) out.childDescription = description;
  if (persisted) out.persistedOutputPath = persisted;
  if (durationMs !== undefined) out.durationMs = durationMs;
  else if (durationSeconds !== undefined) out.durationMs = Math.round(durationSeconds * 1000);
  return out;
}

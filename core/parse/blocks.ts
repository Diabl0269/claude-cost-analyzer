/**
 * Content-block readers for `message.content` on `assistant` and `user` lines.
 *
 * `chars` is the attribution unit from SPEC §5.3: thinking text length, visible text length, and
 * `JSON.stringify(input).length` for a tool call.
 */
import type { ParsedBlock, ToolResultShape } from '../types.js';
import { asArray, asRecord, asString, joinStrings, str } from './raw.js';

export interface RawToolUse {
  id: string;
  name: string;
  input: unknown;
  inputChars: number;
  inputJson: string;
}

export interface AssistantContent {
  blocks: ParsedBlock[];
  /** text + thinking + tool name + tool input JSON */
  searchText: string;
  /** what a reader sees: the text blocks only */
  visibleText: string;
  toolUses: RawToolUse[];
  hasFallbackBlock: boolean;
}

export function readAssistantContent(content: unknown): AssistantContent {
  const out: AssistantContent = {
    blocks: [],
    searchText: '',
    visibleText: '',
    toolUses: [],
    hasFallbackBlock: false,
  };
  const items = asArray(content);
  if (!items) {
    const text = asString(content);
    if (text) {
      out.blocks.push({ type: 'text', chars: text.length });
      out.searchText = text;
      out.visibleText = text;
    }
    return out;
  }
  const search: string[] = [];
  const visible: string[] = [];
  for (const item of items) {
    const block = asRecord(item);
    if (!block) continue;
    switch (str(block, 'type')) {
      case 'thinking': {
        const text = str(block, 'thinking') ?? '';
        out.blocks.push({ type: 'thinking', chars: text.length });
        if (text) search.push(text);
        break;
      }
      case 'text': {
        const text = str(block, 'text') ?? '';
        out.blocks.push({ type: 'text', chars: text.length });
        if (text) {
          search.push(text);
          visible.push(text);
        }
        break;
      }
      case 'tool_use': {
        const id = str(block, 'id') ?? '';
        const name = str(block, 'name') ?? '';
        const input = block['input'];
        const inputJson = safeStringify(input);
        out.blocks.push({ type: 'tool_use', chars: inputJson.length, toolUseId: id, toolName: name });
        out.toolUses.push({ id, name, input, inputChars: inputJson.length, inputJson });
        search.push(name, inputJson);
        break;
      }
      case 'fallback': {
        out.hasFallbackBlock = true;
        out.blocks.push({ type: 'fallback', chars: 0 });
        break;
      }
      default:
        out.blocks.push({ type: 'other', chars: 0 });
        break;
    }
  }
  out.searchText = search.join('\n');
  out.visibleText = visible.join('\n');
  return out;
}

export interface RawToolResult {
  toolUseId: string;
  chars: number;
  images: number;
  shape: ToolResultShape;
  isError: boolean;
  text: string;
}

export interface UserContent {
  /** human-visible prompt text (empty for pure tool-result lines) */
  text: string;
  toolResults: RawToolResult[];
}

export function readUserContent(content: unknown): UserContent {
  const asText = asString(content);
  if (asText !== undefined) return { text: asText, toolResults: [] };
  const items = asArray(content);
  if (!items) return { text: '', toolResults: [] };
  const texts: string[] = [];
  const toolResults: RawToolResult[] = [];
  for (const item of items) {
    const block = asRecord(item);
    if (!block) continue;
    const type = str(block, 'type');
    if (type === 'text') {
      const t = str(block, 'text');
      if (t) texts.push(t);
    } else if (type === 'tool_result') {
      toolResults.push(readToolResult(block));
    }
  }
  return { text: texts.join('\n'), toolResults };
}

function readToolResult(block: Record<string, unknown>): RawToolResult {
  const toolUseId = str(block, 'tool_use_id') ?? '';
  const isError = block['is_error'] === true;
  const content = block['content'];
  const asText = asString(content);
  if (asText !== undefined) {
    return { toolUseId, chars: asText.length, images: 0, shape: 'string', isError, text: asText };
  }
  const items = asArray(content) ?? [];
  const texts: string[] = [];
  let images = 0;
  const kinds = new Set<string>();
  for (const item of items) {
    const inner = asRecord(item);
    if (!inner) continue;
    const type = str(inner, 'type') ?? 'other';
    kinds.add(type);
    if (type === 'text') {
      const t = str(inner, 'text');
      if (t) texts.push(t);
    } else if (type === 'image') {
      images += 1;
    }
  }
  const text = texts.join('\n');
  return { toolUseId, chars: text.length, images, shape: shapeOf(kinds), isError, text };
}

function shapeOf(kinds: Set<string>): ToolResultShape {
  if (kinds.size === 0) return 'text';
  if (kinds.size > 1) return 'mixed';
  const [only] = [...kinds];
  if (only === 'text') return 'text';
  if (only === 'image') return 'image';
  if (only === 'tool_reference') return 'tool_reference';
  return 'mixed';
}

/** `JSON.stringify` that survives cycles and `undefined` (tool inputs come straight from JSON). */
export function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * First `n` characters of the human-visible text of a line, whitespace collapsed. Only the first
 * `8n` characters are scanned so a multi-megabyte tool result does not cost a full copy.
 */
export function previewOf(text: string, n = 240): string {
  return text.slice(0, n * 8).replace(/\s+/g, ' ').trim().slice(0, n);
}

/** Best-effort text extraction from the many shapes attachment payload fields take. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const arr = asArray(value);
  if (arr) {
    if (arr.every((v) => typeof v === 'string')) return joinStrings(arr);
    const parts: string[] = [];
    for (const item of arr) {
      const nested = textOf(item);
      if (nested !== undefined) parts.push(nested);
    }
    return parts.length ? parts.join('\n') : undefined;
  }
  const obj = asRecord(value);
  if (obj) {
    for (const key of ['content', 'text', 'file']) {
      if (key in obj) {
        const nested = textOf(obj[key]);
        if (nested !== undefined) return nested;
      }
    }
  }
  return undefined;
}

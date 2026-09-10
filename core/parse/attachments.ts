/**
 * `attachment` lines and `stop_hook_summary` system lines → injections (what text entered the
 * model's context) and hook runs (SPEC §3.4 and §5.3).
 *
 * Rule of thumb: `rendered[].content` is what actually entered context, so it wins whenever it is
 * present; otherwise the payload field that carries the text is used, and `charsSource` records
 * which branch ran so the UI can label the estimate.
 */
import type { ParsedHookRun, ParsedInjection } from '../types.js';
import { textOf } from './blocks.js';
import { asArray, asRecord, joinStrings, list, num, parseJson, rec, str } from './raw.js';

const HOOK_ATTACHMENT_TYPES = new Set([
  'hook_success',
  'hook_additional_context',
  'hook_blocking_error',
  'hook_cancelled',
]);

/** Payload fields that carry injected text, in the order SPEC §3.4 lists them. */
const CONTENT_FIELDS = ['content', 'text', 'addedLines', 'addedBlocks', 'snippet', 'prompt', 'systemPrompt'];

/** `hook_success.stdout` only enters context for these events. */
const STDOUT_INJECTING_EVENTS = new Set(['UserPromptSubmit', 'SessionStart']);

export interface LinePosition {
  seq: number;
  turnIndex: number;
  ts?: string;
}

export interface AttachmentOutcome {
  injections: ParsedInjection[];
  hooks: ParsedHookRun[];
  /** human-visible text of the line, for `ParsedMessage.preview` */
  preview: string;
}

export function readAttachment(
  at: LinePosition,
  attachment: Record<string, unknown>,
  rendered: unknown,
): AttachmentOutcome {
  const type = str(attachment, 'type') ?? 'unknown';
  const renderedText = renderedTextOf(rendered);
  if (HOOK_ATTACHMENT_TYPES.has(type)) return readHookAttachment(at, type, attachment);

  const out: AttachmentOutcome = { injections: [], hooks: [], preview: renderedText ?? '' };
  const payload = payloadTextOf(attachment);
  if (out.preview === '') out.preview = payload?.text ?? '';

  if (type === 'prompt_snapshot') {
    // The full system prompt is only billed when the harness recorded that it was rendered.
    if (renderedText === undefined) return out;
    out.injections.push({
      ...at,
      kind: 'system_prompt',
      name: type,
      chars: renderedText.length,
      charsSource: 'rendered',
    });
    return out;
  }

  if (renderedText !== undefined) {
    out.injections.push({ ...at, kind: 'attachment', name: type, chars: renderedText.length, charsSource: 'rendered' });
  } else if (payload) {
    out.injections.push({ ...at, kind: 'attachment', name: type, chars: payload.text.length, charsSource: 'content' });
  } else {
    // Unknown shape: fall back to the JSON size of the payload minus its `type` envelope.
    const { type: _type, ...body } = attachment;
    const json = JSON.stringify(body) ?? '';
    out.injections.push({
      ...at,
      kind: 'attachment',
      name: type,
      chars: json.length > 2 ? json.length : 0,
      charsSource: json.length > 2 ? 'json' : 'none',
    });
  }
  return out;
}

function readHookAttachment(
  at: LinePosition,
  type: string,
  attachment: Record<string, unknown>,
): AttachmentOutcome {
  const out: AttachmentOutcome = { injections: [], hooks: [], preview: '' };
  const hookName = str(attachment, 'hookName');
  const hookEvent = str(attachment, 'hookEvent');

  if (type === 'hook_additional_context') {
    const text = joinStrings(list(attachment, 'content'));
    out.preview = text;
    if (text) {
      out.injections.push({
        ...at,
        kind: 'hook_context',
        name: hookName ?? 'hook',
        chars: text.length,
        charsSource: 'content',
        ...(hookName ? { hookName } : {}),
        ...(hookEvent ? { hookEvent } : {}),
      });
    }
    out.hooks.push(hookRun(at, 'additional_context', attachment, text.length));
    return out;
  }

  if (type === 'hook_blocking_error') {
    const blocking = rec(attachment, 'blockingError');
    const text = str(blocking, 'blockingError') ?? '';
    out.preview = text;
    if (text) {
      out.injections.push({
        ...at,
        kind: 'hook_blocking',
        name: hookName ?? 'hook',
        chars: text.length,
        charsSource: 'content',
        ...(hookName ? { hookName } : {}),
        ...(hookEvent ? { hookEvent } : {}),
      });
    }
    const run = hookRun(at, 'blocking_error', attachment, text.length);
    const command = str(blocking, 'command');
    if (command && !run.command) run.command = command;
    out.hooks.push(run);
    return out;
  }

  if (type === 'hook_cancelled') {
    out.hooks.push(hookRun(at, 'cancelled', attachment, 0));
    return out;
  }

  // hook_success
  const stdout = str(attachment, 'stdout') ?? '';
  const injects = hookEvent !== undefined && STDOUT_INJECTING_EVENTS.has(hookEvent) && isInjectableStdout(stdout);
  out.preview = injects ? stdout : '';
  if (injects) {
    out.injections.push({
      ...at,
      kind: 'hook_stdout',
      name: hookName ?? 'hook',
      chars: stdout.length,
      charsSource: 'content',
      ...(hookName ? { hookName } : {}),
      ...(hookEvent ? { hookEvent } : {}),
    });
  }
  out.hooks.push(hookRun(at, 'success', attachment, injects ? stdout.length : 0));
  return out;
}

/** Non-empty stdout that is not a JSON control payload is text the model actually read. */
function isInjectableStdout(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (!trimmed) return false;
  return parseJson(trimmed) === undefined;
}

function hookRun(
  at: LinePosition,
  kind: ParsedHookRun['kind'],
  attachment: Record<string, unknown>,
  injectedChars: number,
): ParsedHookRun {
  const run: ParsedHookRun = { ...at, kind, injectedChars };
  const hookName = str(attachment, 'hookName');
  const hookEvent = str(attachment, 'hookEvent');
  const command = str(attachment, 'command');
  const durationMs = num(attachment, 'durationMs');
  const exitCode = num(attachment, 'exitCode');
  if (hookName) run.hookName = hookName;
  if (hookEvent) run.hookEvent = hookEvent;
  if (command) run.command = command;
  if (durationMs !== undefined) run.durationMs = durationMs;
  if (exitCode !== undefined) run.exitCode = exitCode;
  if (attachment['timedOut'] === true) run.timedOut = true;
  return run;
}

export interface StopHookSummaryOutcome {
  injections: ParsedInjection[];
  hooks: ParsedHookRun[];
}

/**
 * One `stop_hook_summary` line describes several hook executions. Each `hookInfos` entry becomes a
 * run; the injected text is attributed to the first of them so it is never counted twice.
 */
export function readStopHookSummary(
  at: LinePosition,
  line: Record<string, unknown>,
): StopHookSummaryOutcome {
  const text = joinStrings(list(line, 'hookAdditionalContext'));
  const injections: ParsedInjection[] = [];
  if (text) {
    injections.push({
      ...at,
      kind: 'hook_context',
      name: 'stop_hook_summary',
      chars: text.length,
      charsSource: 'content',
      hookEvent: 'Stop',
    });
  }
  const hookCount = num(line, 'hookCount');
  const errorCount = (asArray(line['hookErrors']) ?? []).length;
  const infos = list(line, 'hookInfos');
  const hooks: ParsedHookRun[] = [];
  const make = (info: Record<string, unknown> | undefined, injectedChars: number): ParsedHookRun => {
    const run: ParsedHookRun = { ...at, kind: 'stop_summary', hookEvent: 'Stop', injectedChars, errorCount };
    if (hookCount !== undefined) run.hookCount = hookCount;
    const command = str(info, 'command');
    const durationMs = num(info, 'durationMs');
    if (command) run.command = command;
    if (durationMs !== undefined) run.durationMs = durationMs;
    return run;
  };
  if (infos.length === 0) {
    hooks.push(make(undefined, text.length));
  } else {
    infos.forEach((info, i) => hooks.push(make(asRecord(info), i === 0 ? text.length : 0)));
  }
  return { injections, hooks };
}

/** Concatenated `rendered[].content`; `undefined` when the line carries no `rendered`. */
function renderedTextOf(rendered: unknown): string | undefined {
  const items = asArray(rendered);
  if (!items) return undefined;
  const parts: string[] = [];
  for (const item of items) {
    const obj = asRecord(item);
    const text = textOf(obj ? obj['content'] : item);
    if (text !== undefined) parts.push(text);
  }
  return parts.join('\n');
}

function payloadTextOf(attachment: Record<string, unknown>): { field: string; text: string } | undefined {
  for (const field of CONTENT_FIELDS) {
    if (!(field in attachment)) continue;
    const text = textOf(attachment[field]);
    if (text !== undefined && text.length > 0) return { field, text };
  }
  return undefined;
}

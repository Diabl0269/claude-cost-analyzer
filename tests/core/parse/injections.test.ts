import { afterAll, describe, expect, it } from 'vitest';
import { parseTranscript } from '../../../core/parse/index.js';
import { A1, A3, cleanupScratch, fixtureFile, tempTranscript, userLine } from './helpers.js';

afterAll(cleanupScratch);

function attachmentLine(payload: Record<string, unknown>, rendered?: unknown): Record<string, unknown> {
  const line: Record<string, unknown> = {
    type: 'attachment', uuid: 'u-att', parentUuid: null,
    timestamp: '2026-09-01T09:00:00.000Z', sessionId: 's', cwd: '/tmp', attachment: payload,
  };
  if (rendered !== undefined) line['rendered'] = rendered;
  return line;
}

describe('injections', () => {
  it('records every injected span of the fixture session with the right kind and source', async () => {
    const { injections } = await parseTranscript(fixtureFile(A1));
    expect(injections.map((i) => [i.seq, i.kind, i.name, i.chars, i.charsSource])).toEqual([
      [0, 'hook_stdout', 'SessionStart:startup', 30, 'content'],
      [1, 'attachment', 'total_tokens_reminder', 47, 'content'],
      [2, 'user_prompt', 'prompt', 48, 'content'],
      [3, 'hook_context', 'UserPromptSubmit', 39, 'content'],
      [7, 'attachment', 'task_reminder', 33, 'content'],
      [8, 'user_prompt', 'prompt', 41, 'content'],
      [15, 'hook_blocking', 'PostToolUse:Edit', 41, 'content'],
      [16, 'hook_context', 'stop_hook_summary', 11, 'content'],
      [19, 'user_prompt', 'prompt', 24, 'content'],
      [21, 'attachment', 'skill_listing', 78, 'rendered'],
    ]);
    // skill_listing has both `content` (41) and `rendered` (78): rendered wins.
    expect(injections.find((i) => i.name === 'skill_listing')!.chars).toBe(78);
  });

  it('counts a compact summary as its own injection kind', async () => {
    const { injections } = await parseTranscript(fixtureFile(A3));
    const compact = injections.find((i) => i.kind === 'compact_summary')!;
    expect(compact.seq).toBe(3);
    expect(compact.chars).toBe(152);
  });

  it('prefers rendered[].content over the payload field', async () => {
    const file = await tempTranscript([
      attachmentLine({ type: 'total_tokens_reminder', text: 'short' }, [{ content: 'a much longer rendered body' }]),
    ]);
    const [injection] = (await parseTranscript(file)).injections;
    expect(injection!.charsSource).toBe('rendered');
    expect(injection!.chars).toBe('a much longer rendered body'.length);
  });

  it('reads addedLines, addedBlocks, snippet and prompt payloads', async () => {
    const file = await tempTranscript([
      attachmentLine({ type: 'agent_listing_delta', addedLines: ['ab', 'cde'] }),
      attachmentLine({ type: 'mcp_instructions_delta', addedBlocks: ['xy'] }),
      attachmentLine({ type: 'edited_text_file', filename: '/a', snippet: '12345' }),
      attachmentLine({ type: 'queued_command', prompt: 'abcd' }),
      attachmentLine({ type: 'file', filename: '/a', content: { type: 'text', file: { filePath: '/a', content: 'seven!!' } } }),
    ]);
    const { injections } = await parseTranscript(file);
    expect(injections.map((i) => [i.name, i.chars, i.charsSource])).toEqual([
      ['agent_listing_delta', 6, 'content'], // "ab\ncde"
      ['mcp_instructions_delta', 2, 'content'],
      ['edited_text_file', 5, 'content'],
      ['queued_command', 4, 'content'],
      ['file', 7, 'content'],
    ]);
  });

  it('falls back to the JSON size of an unknown attachment payload', async () => {
    const file = await tempTranscript([attachmentLine({ type: 'brand_new_thing', names: ['a', 'b'] })]);
    const [injection] = (await parseTranscript(file)).injections;
    expect(injection!.charsSource).toBe('json');
    expect(injection!.chars).toBe(JSON.stringify({ names: ['a', 'b'] }).length);
  });

  it('records nothing when an unknown attachment has no payload at all', async () => {
    const file = await tempTranscript([attachmentLine({ type: 'empty_thing' })]);
    const [injection] = (await parseTranscript(file)).injections;
    expect(injection!.chars).toBe(0);
    expect(injection!.charsSource).toBe('none');
  });

  it('counts prompt_snapshot only when it was rendered', async () => {
    const notRendered = await tempTranscript([
      attachmentLine({ type: 'prompt_snapshot', systemPrompt: ['a very long system prompt'] }),
    ]);
    expect((await parseTranscript(notRendered)).injections).toEqual([]);

    const rendered = await tempTranscript([
      attachmentLine({ type: 'prompt_snapshot', systemPrompt: ['ignored'] }, [{ content: 'SYSTEM PROMPT BODY' }]),
    ]);
    const [injection] = (await parseTranscript(rendered)).injections;
    expect(injection!.kind).toBe('system_prompt');
    expect(injection!.chars).toBe('SYSTEM PROMPT BODY'.length);
    expect(injection!.charsSource).toBe('rendered');
  });

  it('counts hook_success stdout only for UserPromptSubmit / SessionStart and only when it is not JSON', async () => {
    const base = { hookName: 'H', command: './h.sh', durationMs: 5, exitCode: 0, stderr: '' };
    const file = await tempTranscript([
      attachmentLine({ type: 'hook_success', ...base, hookEvent: 'SessionStart', stdout: 'context text\n' }),
      attachmentLine({ type: 'hook_success', ...base, hookEvent: 'UserPromptSubmit', stdout: 'more text' }),
      attachmentLine({ type: 'hook_success', ...base, hookEvent: 'PostToolUse', stdout: 'not injected' }),
      attachmentLine({ type: 'hook_success', ...base, hookEvent: 'SessionStart', stdout: '{"ok":true}\n' }),
      attachmentLine({ type: 'hook_success', ...base, hookEvent: 'SessionStart', stdout: '   ' }),
    ]);
    const { injections, hooks } = await parseTranscript(file);
    expect(injections.map((i) => [i.seq, i.chars])).toEqual([[0, 13], [1, 9]]);
    expect(injections.every((i) => i.kind === 'hook_stdout')).toBe(true);
    expect(hooks).toHaveLength(5);
    expect(hooks.map((h) => h.injectedChars)).toEqual([13, 9, 0, 0, 0]);
  });

  it('does not index or count a user prompt twice', async () => {
    const file = await tempTranscript([userLine('hello there')]);
    const { injections } = await parseTranscript(file);
    expect(injections).toHaveLength(1);
    expect(injections[0]!.chars).toBe('hello there'.length);
  });
});

describe('hook runs', () => {
  it('records one run per hook source in the fixture session', async () => {
    const { hooks } = await parseTranscript(fixtureFile(A1));
    expect(hooks.map((h) => [h.seq, h.kind, h.hookName ?? h.hookEvent, h.command, h.durationMs, h.injectedChars])).toEqual([
      [0, 'success', 'SessionStart:startup', './scripts/session-start.sh', 42, 30],
      [3, 'additional_context', 'UserPromptSubmit', undefined, undefined, 39],
      [15, 'blocking_error', 'PostToolUse:Edit', './scripts/check-exports.sh', undefined, 41],
      [16, 'stop_summary', 'Stop', './scripts/lint.sh', 120, 11],
      [16, 'stop_summary', 'Stop', './scripts/notify.sh', 30, 0],
    ]);
    const summary = hooks.filter((h) => h.kind === 'stop_summary');
    expect(summary.every((h) => h.hookCount === 2 && h.errorCount === 0)).toBe(true);
  });

  it('records a cancelled hook with its timeout flag and no injection', async () => {
    const file = await tempTranscript([
      attachmentLine({ type: 'hook_cancelled', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', command: './slow.sh', durationMs: 428298, timedOut: true, timeoutMs: 10000 }),
    ]);
    const { hooks, injections } = await parseTranscript(file);
    expect(injections).toEqual([]);
    expect(hooks[0]).toMatchObject({ kind: 'cancelled', timedOut: true, durationMs: 428298, injectedChars: 0 });
  });

  it('emits a single run for a stop_hook_summary with no hookInfos', async () => {
    const file = await tempTranscript([
      { type: 'system', subtype: 'stop_hook_summary', uuid: 'u', timestamp: '2026-09-01T09:00:00.000Z', hookCount: 0, hookInfos: [], hookErrors: ['boom'], hookAdditionalContext: ['ctx'] },
    ]);
    const { hooks, injections } = await parseTranscript(file);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.errorCount).toBe(1);
    expect(hooks[0]!.injectedChars).toBe(3);
    expect(injections[0]!.kind).toBe('hook_context');
  });
});

describe('compactions and API errors', () => {
  it('reads compact_boundary metadata', async () => {
    const { compactions } = await parseTranscript(fixtureFile(A3));
    expect(compactions).toEqual([
      {
        seq: 2, turnIndex: 1, ts: '2026-09-03T11:00:02.000Z', trigger: 'auto',
        preTokens: 180000, postTokens: 14000, durationMs: 9000, cumulativeDroppedTokens: 166000,
      },
    ]);
  });

  it('reads api_error system lines', async () => {
    const { apiErrors } = await parseTranscript(fixtureFile(A3));
    expect(apiErrors).toEqual([
      { seq: 6, ts: '2026-09-03T11:00:06.000Z', status: 500, message: '500 status code (no body)', retryAttempt: 1, maxRetries: 10 },
    ]);
  });
});

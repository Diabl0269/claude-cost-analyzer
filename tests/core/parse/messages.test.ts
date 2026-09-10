import { afterAll, describe, expect, it } from 'vitest';
import { parseTranscript } from '../../../core/parse/index.js';
import { A1, A2, A3, assistantLine, cleanupScratch, fixtureFile, tempTranscript, usage, userLine } from './helpers.js';

afterAll(cleanupScratch);

describe('turn indexing', () => {
  it('starts a turn at each human prompt and puts everything before the first one in turn 0', async () => {
    const transcript = await parseTranscript(fixtureFile(A1));
    const byTurn = new Map(transcript.messages.map((m) => [m.seq, m.turnIndex]));
    expect(byTurn.get(0)).toBe(0); // SessionStart hook, before any prompt
    expect(byTurn.get(1)).toBe(0);
    expect(byTurn.get(2)).toBe(1); // first prompt
    expect(byTurn.get(7)).toBe(1);
    expect(byTurn.get(8)).toBe(2); // second prompt
    expect(byTurn.get(18)).toBe(2);
    expect(byTurn.get(19)).toBe(3); // third prompt
    expect(byTurn.get(22)).toBe(3);
    expect(transcript.promptCount).toBe(3);
    expect(transcript.requests.map((r) => r.turnIndex)).toEqual([1, 2, 2, 3]);
  });

  it('does not start a turn on tool results, compact summaries, meta or interrupts', async () => {
    const file = await tempTranscript([
      userLine('<system-reminder>be careful</system-reminder>'),
      userLine('real prompt'),
      assistantLine({ id: 'msg_t1', model: 'claude-opus-5', content: [{ type: 'text', text: 'ok' }], usage: usage({ output: 10 }) }),
      userLine([{ tool_use_id: 't1', type: 'tool_result', content: 'output' }]),
      userLine('summary text', { isCompactSummary: true }),
      userLine('[Request interrupted by user for tool use]'),
      userLine('caveat', { isMeta: true }),
      userLine('second prompt'),
    ]);
    const { messages, promptCount } = await parseTranscript(file);
    expect(messages.map((m) => m.kind)).toEqual([
      'meta', 'prompt', 'assistant', 'tool_result', 'compact_summary', 'interrupt', 'meta', 'prompt',
    ]);
    expect(messages.map((m) => m.turnIndex)).toEqual([0, 1, 1, 1, 1, 1, 1, 2]);
    expect(promptCount).toBe(2);
  });

  it('merges consecutive human prompts with no request between them into one turn', async () => {
    const file = await tempTranscript([
      userLine('do the thing'),
      // a skill expansion and a queued prompt land as further human lines before any API call
      userLine('<command-name>/deploy</command-name> staging'),
      userLine('and also update the changelog'),
      assistantLine({ id: 'msg_m1', model: 'claude-opus-5', content: [{ type: 'text', text: 'on it' }], usage: usage({ output: 20 }) }),
      userLine('next thing'),
      assistantLine({ id: 'msg_m2', model: 'claude-opus-5', content: [{ type: 'text', text: 'done' }], usage: usage({ output: 30 }) }),
    ]);
    const transcript = await parseTranscript(file);
    expect(transcript.messages.map((m) => m.turnIndex)).toEqual([1, 1, 1, 1, 2, 2]);
    // every turn that exists has at least one request in it, and none is empty
    expect(transcript.requests.map((r) => r.turnIndex)).toEqual([1, 2]);
    // prompts are still counted individually; only the turn boundary moved
    expect(transcript.promptCount).toBe(4);
    expect(transcript.injections.filter((i) => i.kind === 'user_prompt')).toHaveLength(4);
  });

  it('a synthetic message does not close a turn, so the prompt after it still merges', async () => {
    const file = await tempTranscript([
      userLine('first ask'),
      assistantLine({ id: 'msg_s1', model: '<synthetic>', content: [{ type: 'text', text: 'Request interrupted' }], usage: usage(), extra: { isApiErrorMessage: true } }),
      userLine('second ask'),
      assistantLine({ id: 'msg_s2', model: 'claude-opus-5', content: [{ type: 'text', text: 'ok' }], usage: usage({ output: 5 }) }),
    ]);
    const transcript = await parseTranscript(file);
    expect(transcript.messages.map((m) => m.turnIndex)).toEqual([1, 1, 1, 1]);
    expect(transcript.promptCount).toBe(2);
  });

  it('classifies an empty user line as meta rather than a turn', async () => {
    const file = await tempTranscript([userLine(''), userLine([])]);
    const { messages, promptCount } = await parseTranscript(file);
    expect(messages.map((m) => m.kind)).toEqual(['meta', 'meta']);
    expect(promptCount).toBe(0);
  });
});

describe('messages', () => {
  it('records a message for every user/assistant/system/attachment line and nothing else', async () => {
    const transcript = await parseTranscript(fixtureFile(A1));
    expect(transcript.meta.lineCount).toBe(30);
    expect(transcript.messages).toHaveLength(23);
    expect(new Set(transcript.messages.map((m) => m.role))).toEqual(
      new Set(['user', 'assistant', 'system', 'attachment']),
    );
    expect(transcript.messages.find((m) => m.seq === 23)).toBeUndefined(); // ai-title
    expect(transcript.messages.find((m) => m.seq === 16)!.subtype).toBe('stop_hook_summary');
    expect(transcript.messages.find((m) => m.seq === 1)!.subtype).toBe('total_tokens_reminder');
  });

  it('points every assistant line at the seq of its deduplicated request', async () => {
    const transcript = await parseTranscript(fixtureFile(A1));
    const assistants = transcript.messages.filter((m) => m.role === 'assistant');
    expect(assistants.map((m) => [m.seq, m.requestSeq])).toEqual([
      [4, 4], [5, 4], [9, 9], [11, 11], [12, 11], [13, 11], [20, 20],
    ]);
    expect(assistants[0]!.messageId).toBe('msg_a1r1');
  });

  it('indexes prompt text, assistant text/thinking/tool JSON and tool-result text; never attachments', async () => {
    const transcript = await parseTranscript(fixtureFile(A1));
    const at = (seq: number) => transcript.messages.find((m) => m.seq === seq)!;
    expect(at(2).searchText).toBe('Rename the helper in utils.ts and run the tests.');
    expect(at(5).searchText).toContain('Bash');
    expect(at(5).searchText).toContain('"command":"ls src"');
    expect(at(11).searchText).toBe('Rename it to nextValue.');
    expect(at(10).searchText).toContain('export function helper');
    expect(at(1).searchText).toBe('');
    expect(at(21).searchText).toBe('');
    expect(at(16).searchText).toBe('');
    // The attachment is still previewable, just not searchable.
    expect(at(21).preview).toContain('alpha-deploy');
  });

  it('caps preview at 240 characters of human-visible text', async () => {
    const transcript = await parseTranscript(fixtureFile(A1));
    const bashResult = transcript.messages.find((m) => m.seq === 6)!;
    expect(bashResult.preview).toHaveLength(240);
    expect(transcript.messages.find((m) => m.seq === 4)!.preview).toBe(''); // thinking is not visible text
  });

  it('carries isMeta and isSidechain through', async () => {
    const file = await tempTranscript([
      userLine('caveat', { isMeta: true, isSidechain: true }),
      assistantLine({ id: 'm1', model: 'claude-opus-5', content: [], usage: usage({ output: 1 }) }),
    ]);
    const { messages } = await parseTranscript(file, { agentId: 'a1' });
    expect(messages[0]!.isMeta).toBe(true);
    expect(messages[0]!.isSidechain).toBe(true);
    expect(messages[1]!.isSidechain).toBe(false);
  });
});

describe('transcript meta', () => {
  it('takes cwd first, gitBranch and version last, and min/max user+assistant timestamps', async () => {
    const file = await tempTranscript([
      userLine('one', { cwd: '/first', gitBranch: 'main', version: '2.1.1', entrypoint: 'cli', sessionKind: 'bg', slug: 'the-slug', timestamp: '2026-09-01T10:00:00.000Z' }),
      { type: 'system', subtype: 'informational', uuid: 'x', timestamp: '2026-09-01T12:00:00.000Z', cwd: '/second', gitBranch: 'feature', version: '2.1.9' },
      assistantLine({ id: 'm1', model: 'claude-opus-5', content: [], usage: usage({ output: 1 }), ts: '2026-09-01T11:00:00.000Z', extra: { cwd: '/third', gitBranch: 'release', version: '2.2.0' } }),
    ]);
    const { meta } = await parseTranscript(file);
    expect(meta.cwd).toBe('/first');
    expect(meta.gitBranch).toBe('release');
    expect(meta.version).toBe('2.2.0');
    expect(meta.entrypoint).toBe('cli');
    expect(meta.sessionKind).toBe('bg');
    expect(meta.slug).toBe('the-slug');
    // The system line at 12:00 does not extend the range.
    expect(meta.firstTs).toBe('2026-09-01T10:00:00.000Z');
    expect(meta.lastTs).toBe('2026-09-01T11:00:00.000Z');
    expect(meta.lineCount).toBe(3);
    expect(meta.parseErrors).toBe(0);
  });

  it('reports the most common effort', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-5', content: [], usage: usage({ output: 1 }), extra: { effort: 'low' } }),
      assistantLine({ id: 'm2', model: 'claude-opus-5', content: [], usage: usage({ output: 1 }), extra: { effort: 'high' } }),
      assistantLine({ id: 'm3', model: 'claude-opus-5', content: [], usage: usage({ output: 1 }), extra: { effort: 'high' } }),
    ]);
    expect((await parseTranscript(file)).meta.effort).toBe('high');
  });

  it('reads entrypoint and sessionKind from the fixture session', async () => {
    const { meta } = await parseTranscript(fixtureFile(A3));
    expect(meta.entrypoint).toBe('claude-desktop');
    expect(meta.sessionKind).toBe('bg');
  });

  it('counts malformed lines instead of failing, and keeps seq aligned with the file', async () => {
    const file = await tempTranscript([
      userLine('go'),
      '{"type":"assistant", not json at all',
      '',
      assistantLine({ id: 'm1', model: 'claude-opus-5', content: [{ type: 'text', text: 'ok' }], usage: usage({ output: 4 }) }),
    ]);
    const transcript = await parseTranscript(file);
    expect(transcript.meta.parseErrors).toBe(1);
    expect(transcript.meta.lineCount).toBe(4);
    expect(transcript.requests).toHaveLength(1);
    expect(transcript.requests[0]!.seq).toBe(3);
    expect(transcript.messages.map((m) => m.seq)).toEqual([0, 3]);
  });
});

describe('session facts', () => {
  it('collects every fact of the fixture session', async () => {
    const { facts } = await parseTranscript(fixtureFile(A1));
    expect(facts!.aiTitle).toBe('Rename the utils helper');
    expect(facts!.firstPrompt).toBe('Rename the helper in utils.ts and run the tests.');
    expect(facts!.prLinks).toEqual([
      { url: 'https://github.com/dev/alpha/pull/42', number: 42, repository: 'dev/alpha', ts: '2026-09-01T09:00:23.000Z' },
    ]);
    expect(facts!.localCommands).toEqual(['/status']);
    expect(facts!.queuedOperations).toBe(1);
    expect(facts!.turnDurationsMs).toEqual([45000, 12000]);
    expect(facts!.mode).toBe('normal');
    expect(facts!.permissionMode).toBe('auto');
    expect(facts!.awaySummaries).toBe(0);
  });

  it('reads the last cost-state and keeps the [1m] model key verbatim', async () => {
    const { facts } = await parseTranscript(fixtureFile(A1));
    const reported = facts!.reportedCost!;
    expect(reported.totalCostUSD).toBeCloseTo(0.1843, 10);
    expect(Object.keys(reported.modelUsage)).toEqual(['claude-opus-5[1m]', 'claude-haiku-4-5-20251001']);
    expect(reported.modelUsage['claude-opus-5[1m]']).toEqual({
      inputTokens: 20, outputTokens: 900, thinkingTokens: 150,
      cacheReadInputTokens: 41000, cacheCreationInputTokens: 21500,
      webSearchRequests: 0, costUSD: 0.177475,
    });
    expect(reported.totalAPIDurationMs).toBe(8100);
    expect(reported.hasUnknownModelCost).toBeUndefined();
  });

  it('keeps only the last cost-state line', async () => {
    const file = await tempTranscript([
      { type: 'cost-state', sessionId: 's', totalCostUSD: 1, modelUsage: {} },
      { type: 'cost-state', sessionId: 's', totalCostUSD: 2, modelUsage: {}, hasUnknownModelCost: true },
    ]);
    const { facts } = await parseTranscript(file);
    expect(facts!.reportedCost!.totalCostUSD).toBe(2);
    expect(facts!.reportedCost!.hasUnknownModelCost).toBe(true);
  });

  it('records continued-in, custom titles and relocation', async () => {
    const a2 = await parseTranscript(fixtureFile(A2));
    expect(a2.facts!.customTitle).toBe('Build failure triage');
    const a3 = await parseTranscript(fixtureFile(A3));
    expect(a3.facts!.continuedInSessionId).toBe(A1);

    const file = await tempTranscript([
      { type: 'relocated', sessionId: 's', relocatedCwd: '/w/.claude/worktrees/x' },
      { type: 'agent-name', agentName: 'Named agent', sessionId: 's' },
      { type: 'system', subtype: 'away_summary', uuid: 'u', content: 'recap' },
    ]);
    const { facts } = await parseTranscript(file);
    expect(facts!.relocatedCwd).toBe('/w/.claude/worktrees/x');
    expect(facts!.agentName).toBe('Named agent');
    expect(facts!.awaySummaries).toBe(1);
  });

  it('collects no facts for a subagent transcript', async () => {
    const file = await tempTranscript([{ type: 'ai-title', aiTitle: 'x', sessionId: 's' }], { kind: 'subagent', agentId: 'a1' });
    const transcript = await parseTranscript(file, { agentId: 'a1' });
    expect(transcript.facts).toBeUndefined();
    expect(transcript.agentId).toBe('a1');
  });
});

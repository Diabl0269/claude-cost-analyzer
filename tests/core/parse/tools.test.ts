import { afterAll, describe, expect, it } from 'vitest';
import { parseTranscript, splitMcpName, summarizeToolInput } from '../../../core/parse/index.js';
import { A1, A2, assistantLine, cleanupScratch, fixtureFile, tempTranscript, usage, userLine } from './helpers.js';

afterAll(cleanupScratch);

describe('tool_use ↔ tool_result linking', () => {
  it('links each call to the later user line that answers it', async () => {
    const { toolCalls } = await parseTranscript(fixtureFile(A1));
    expect(toolCalls.map((c) => [c.name, c.requestSeq, c.resultSeq, c.turnIndex])).toEqual([
      ['Bash', 4, 6, 1],
      ['Read', 9, 10, 2],
      ['Edit', 11, 14, 2],
    ]);
    const bash = toolCalls[0]!;
    expect(bash.inputSummary).toBe('ls src');
    expect(bash.inputChars).toBe(JSON.stringify({ command: 'ls src', description: 'List source files' }).length);
    expect(bash.resultChars).toBe(1200);
    expect(bash.resultShape).toBe('string');
    expect(bash.isError).toBe(false);
    expect(bash.childDescription).toBeUndefined();
    expect(toolCalls[1]!.resultShape).toBe('text');
    expect(toolCalls[1]!.inputSummary).toBe('/Users/dev/projects/alpha/src/utils.ts');
  });

  it('reports a missing result rather than dropping the call', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-5', usage: usage({ output: 5 }), content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 1' } }] }),
    ]);
    const [call] = (await parseTranscript(file)).toolCalls;
    expect(call!.resultSeq).toBeUndefined();
    expect(call!.resultShape).toBe('missing');
    expect(call!.resultChars).toBe(0);
  });

  it('counts images, marks errors and records mixed result shapes', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-5', usage: usage({ output: 5 }), content: [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.png' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'false' } },
      ] }),
      userLine([{ tool_use_id: 't1', type: 'tool_result', content: [{ type: 'text', text: 'shot' }, { type: 'image', source: {} }, { type: 'image', source: {} }] }]),
      userLine([{ tool_use_id: 't2', type: 'tool_result', is_error: true, content: 'command failed' }]),
    ]);
    const calls = (await parseTranscript(file)).toolCalls;
    expect(calls[0]!.resultImages).toBe(2);
    expect(calls[0]!.resultShape).toBe('mixed');
    expect(calls[0]!.resultChars).toBe(4);
    expect(calls[1]!.isError).toBe(true);
    expect(calls[1]!.resultPreview).toBe('command failed');
  });

  it('picks up persistedOutputPath and durationMs from toolUseResult', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-5', usage: usage({ output: 5 }), content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat big' } }] }),
      userLine([{ tool_use_id: 't1', type: 'tool_result', content: 'preview' }], {
        toolUseResult: { stdout: 'preview', stderr: '', persistedOutputPath: '/tmp/out.txt', persistedOutputSize: 68171, durationMs: 1234 },
      }),
    ]);
    const [call] = (await parseTranscript(file)).toolCalls;
    expect(call!.persistedOutputPath).toBe('/tmp/out.txt');
    expect(call!.durationMs).toBe(1234);
  });
});

describe('child links', () => {
  it('links a synchronous Agent call to its agent id', async () => {
    const { toolCalls } = await parseTranscript(fixtureFile(A2));
    const sync = toolCalls.find((c) => c.toolUseId === 'toolu_a2_agent_sync')!;
    expect(sync.name).toBe('Agent');
    expect(sync.childAgentId).toBe('b1000000000000001');
    expect(sync.childDescription).toBe('Trace build failure');
    expect(sync.inputSummary).toBe('Trace build failure');
    expect(sync.durationMs).toBe(90014);
  });

  it('links an async Agent launch and its resolved model', async () => {
    const { toolCalls } = await parseTranscript(fixtureFile(A2));
    const async = toolCalls.find((c) => c.toolUseId === 'toolu_a2_agent_async')!;
    expect(async.childAgentId).toBe('b2000000000000002');
    expect(async.childModel).toBe('claude-haiku-4-5-20251001');
    expect(async.childDescription).toBe('Draft the release note');
  });

  it('links a Workflow call to its run id', async () => {
    const { toolCalls } = await parseTranscript(fixtureFile(A2));
    const workflow = toolCalls.find((c) => c.name === 'Workflow')!;
    expect(workflow.childRunId).toBe('wf_test1');
    expect(workflow.childAgentId).toBeUndefined();
  });

  it('falls back to input.model for an Agent whose result has no resolvedModel', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-5', usage: usage({ output: 5 }), content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Do the thing', prompt: 'p', model: 'sonnet' } }] }),
      userLine([{ tool_use_id: 't1', type: 'tool_result', content: 'done' }], { toolUseResult: { agentId: 'a9', agentType: 'general-purpose', status: 'completed' } }),
    ]);
    const [call] = (await parseTranscript(file)).toolCalls;
    expect(call!.childModel).toBe('sonnet');
    expect(call!.childDescription).toBe('Do the thing');
  });
});

describe('tool naming and input summaries', () => {
  it('splits mcp__<server>__<tool>, keeping underscores in both halves', () => {
    expect(splitMcpName('mcp__claude_ai_Slack__slack_send_message')).toEqual({
      mcpServer: 'claude_ai_Slack', mcpTool: 'slack_send_message',
    });
    expect(splitMcpName('mcp__metrics-grafana__query_loki_logs')).toEqual({
      mcpServer: 'metrics-grafana', mcpTool: 'query_loki_logs',
    });
    expect(splitMcpName('Bash')).toEqual({});
  });

  it('applies the per-tool summary heuristics', () => {
    expect(summarizeToolInput('Bash', { command: 'git status', description: 'd' })).toBe('git status');
    expect(summarizeToolInput('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(summarizeToolInput('Write', { file_path: '/a/b.ts', content: 'x' })).toBe('/a/b.ts');
    expect(summarizeToolInput('Edit', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(summarizeToolInput('Agent', { description: 'Trace it', prompt: 'long' })).toBe('Trace it');
    expect(summarizeToolInput('Skill', { skill: 'code-review' })).toBe('code-review');
    expect(summarizeToolInput('WebFetch', { url: 'https://example.com' })).toBe('https://example.com');
    expect(summarizeToolInput('mcp__x__y', { limit: 5, query: 'find me' })).toBe('find me');
    expect(summarizeToolInput('Unknown', { a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it('collapses whitespace and caps summaries at 160 characters', () => {
    const summary = summarizeToolInput('Bash', { command: `echo ${'a'.repeat(400)}` });
    expect(summary).toHaveLength(160);
    expect(summarizeToolInput('Bash', { command: 'a\n  b' })).toBe('a b');
  });

  it('stores mcpServer and mcpTool on the parsed call', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-5', usage: usage({ output: 5 }), content: [{ type: 'tool_use', id: 't1', name: 'mcp__grafana-sso__query_prometheus', input: { expr: 'up' } }] }),
    ]);
    const [call] = (await parseTranscript(file)).toolCalls;
    expect(call!.mcpServer).toBe('grafana-sso');
    expect(call!.mcpTool).toBe('query_prometheus');
  });
});

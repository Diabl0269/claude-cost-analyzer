import { afterAll, describe, expect, it } from 'vitest';
import { normalizeUsage } from '../../../core/parse/usage.js';
import { parseTranscript } from '../../../core/parse/index.js';
import { A1, A3, assistantLine, cleanupScratch, fixtureFile, tempTranscript, usage, userLine } from './helpers.js';

afterAll(cleanupScratch);

describe('assistant dedup', () => {
  it('bills the line with the largest output_tokens and merges every line into one request', async () => {
    const transcript = await parseTranscript(fixtureFile(A1));
    const r1 = transcript.requests.find((r) => r.messageId === 'msg_a1r1')!;
    expect(transcript.requests).toHaveLength(4);
    // seq 4 is the streaming placeholder (output_tokens 5), seq 5 the final line.
    expect(r1.seq).toBe(4);
    expect(r1.usage.output).toBe(200);
    expect(r1.usage.thinking).toBe(50);
    expect(r1.lines).toHaveLength(2);
    expect(r1.requestId).toBe('req_a1r1');
  });

  it('merges blocks in apiBlockIndex order, not file order', async () => {
    const transcript = await parseTranscript(fixtureFile(A1));
    const r3 = transcript.requests.find((r) => r.messageId === 'msg_a1r3')!;
    // Written to the file as thinking(0), tool_use(2), text(1).
    expect(r3.blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(r3.lines).toHaveLength(3);
    expect(r3.seq).toBe(11);
  });

  it('breaks output_tokens ties with the last line in file order', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-5', content: [{ type: 'text', text: 'first' }], usage: usage({ output: 7 }), extra: { effort: 'low' } }),
      assistantLine({ id: 'm1', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'second' }], usage: usage({ output: 7 }), extra: { effort: 'high' } }),
    ]);
    const [request] = (await parseTranscript(file)).requests;
    expect(request!.model).toBe('claude-sonnet-5');
    expect(request!.effort).toBe('high');
  });

  it('falls back to requestId then uuid when message.id is missing', async () => {
    const file = await tempTranscript([
      { type: 'assistant', uuid: 'u-1', requestId: 'req_x', timestamp: '2026-09-01T09:00:00.000Z', message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'a' }], usage: usage({ output: 1 }) } },
      { type: 'assistant', uuid: 'u-2', requestId: 'req_x', timestamp: '2026-09-01T09:00:01.000Z', message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'b' }], usage: usage({ output: 9 }) } },
      { type: 'assistant', uuid: 'u-3', timestamp: '2026-09-01T09:00:02.000Z', message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'c' }], usage: usage({ output: 3 }) } },
    ]);
    const { requests } = await parseTranscript(file);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.messageId).toBe('req_x');
    expect(requests[0]!.usage.output).toBe(9);
    expect(requests[1]!.messageId).toBe('u-3');
  });
});

describe('iterations and fallback', () => {
  it('exposes both iterations of a model fallback and flags the request', async () => {
    const transcript = await parseTranscript(fixtureFile(A3));
    const fallback = transcript.requests.find((r) => r.messageId === 'msg_a3r2')!;
    expect(fallback.isFallback).toBe(true);
    expect(fallback.model).toBe('claude-opus-4-8');
    expect(fallback.iterations).toHaveLength(2);
    expect(fallback.iterations!.map((i) => [i.model, i.type, i.usage.output])).toEqual([
      ['claude-fable-5-1', 'message', 100],
      ['claude-opus-4-8', 'fallback_message', 500],
    ]);
    expect(fallback.iterations![0]!.usage.cacheRead).toBe(30000);
    // Top-level usage equals only the last iteration.
    expect(fallback.usage.output).toBe(500);
    expect(fallback.blocks.map((b) => b.type)).toEqual(['fallback']);
  });

  it('leaves iterations undefined when the API reported exactly one', async () => {
    const transcript = await parseTranscript(fixtureFile(A3));
    const plain = transcript.requests.find((r) => r.messageId === 'msg_a3r1')!;
    expect(plain.iterations).toBeUndefined();
    expect(plain.isFallback).toBe(false);
  });

  it('flags a fallback that only shows up as a content block', async () => {
    const file = await tempTranscript([
      assistantLine({ id: 'm1', model: 'claude-opus-4-8', content: [{ type: 'fallback', from: { model: 'claude-fable-5' }, to: { model: 'claude-opus-4-8' } }], usage: usage({ output: 10 }) }),
    ]);
    expect((await parseTranscript(file)).requests[0]!.isFallback).toBe(true);
  });
});

describe('synthetic messages', () => {
  it('marks <synthetic> and keeps it in the transcript with zero usage', async () => {
    const transcript = await parseTranscript(fixtureFile(A3));
    const synthetic = transcript.requests.find((r) => r.model === '<synthetic>')!;
    expect(synthetic.isSynthetic).toBe(true);
    expect(synthetic.isApiError).toBe(true);
    expect(synthetic.contextTokens).toBe(0);
    expect(synthetic.usage).toMatchObject({ input: 0, output: 0, cacheRead: 0, cache5m: 0, cache1h: 0 });
    expect(synthetic.speed).toBe('standard');
    expect(synthetic.serviceTier).toBe('standard');
    expect(synthetic.inferenceGeo).toBe('global');
  });
});

describe('usage normalization', () => {
  it('splits cache writes by the reported TTL buckets', () => {
    const u = normalizeUsage(usage({ input: 2, c5: 100, c1: 900, read: 50, output: 7, thinking: 3 }));
    expect(u).toEqual({
      input: 2, output: 7, cacheRead: 50, cache5m: 100, cache1h: 900, thinking: 3,
      webSearchRequests: 0, webFetchRequests: 0,
    });
    expect(u.assumedTtl).toBeUndefined();
  });

  it('assumes 5m and flags assumedTtl when cache_creation is missing', () => {
    const u = normalizeUsage({ input_tokens: 1, cache_creation_input_tokens: 4000, output_tokens: 2 });
    expect(u.cache5m).toBe(4000);
    expect(u.cache1h).toBe(0);
    expect(u.assumedTtl).toBe(true);
  });

  it('does not flag assumedTtl when there is no cache write at all', () => {
    expect(normalizeUsage({ input_tokens: 1, output_tokens: 2 }).assumedTtl).toBeUndefined();
  });

  it('falls back to the declared total when the TTL breakdown contradicts it', () => {
    const u = normalizeUsage({
      cache_creation_input_tokens: 500,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    });
    expect(u.cache5m).toBe(500);
    expect(u.assumedTtl).toBe(true);
  });

  it('reads thinking tokens, server tool counts and tolerates nulls', () => {
    const u = normalizeUsage({
      input_tokens: 5, output_tokens: 40,
      output_tokens_details: { thinking_tokens: 30 },
      server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
      cache_creation: null,
    });
    expect(u.thinking).toBe(30);
    expect(u.webSearchRequests).toBe(2);
    expect(u.webFetchRequests).toBe(1);
  });

  it('carries the fast / us / batch modifiers through to the request', async () => {
    const u = usage({ input: 10, output: 5 });
    u['speed'] = 'fast';
    u['inference_geo'] = 'us';
    u['service_tier'] = 'batch';
    const file = await tempTranscript([assistantLine({ id: 'm1', model: 'claude-opus-5', content: [], usage: u })]);
    const [request] = (await parseTranscript(file)).requests;
    expect(request!.speed).toBe('fast');
    expect(request!.inferenceGeo).toBe('us');
    expect(request!.serviceTier).toBe('batch');
  });

  it('treats an unknown inference_geo as global', async () => {
    const u = usage({ input: 1 });
    u['inference_geo'] = 'not_available';
    const file = await tempTranscript([assistantLine({ id: 'm1', model: 'claude-sonnet-4-6', content: [], usage: u })]);
    expect((await parseTranscript(file)).requests[0]!.inferenceGeo).toBe('global');
  });
});

describe('blocks and context', () => {
  it('measures thinking text, visible text and tool input JSON', async () => {
    const input = { command: 'ls src', description: 'List source files' };
    const file = await tempTranscript([
      assistantLine({
        id: 'm1', model: 'claude-opus-5', usage: usage({ input: 1, c5: 2, c1: 3, read: 4, output: 5 }),
        content: [
          { type: 'thinking', thinking: 'abcde', signature: 'sig' },
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input },
          { type: 'image', source: { type: 'base64', data: 'zz' } },
        ],
      }),
    ]);
    const [request] = (await parseTranscript(file)).requests;
    expect(request!.blocks).toEqual([
      { type: 'thinking', chars: 5 },
      { type: 'text', chars: 5 },
      { type: 'tool_use', chars: JSON.stringify(input).length, toolUseId: 'toolu_1', toolName: 'Bash' },
      { type: 'other', chars: 0 },
    ]);
    expect(request!.contextTokens).toBe(1 + 4 + 2 + 3);
  });

  it('records attribution and effort from the billed line', async () => {
    const file = await tempTranscript([
      assistantLine({
        id: 'm1', model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }], usage: usage({ output: 1 }),
        extra: { effort: 'xhigh', attributionSkill: 'code-review', attributionPlugin: 'security-review', attributionMcpServer: 'grafana', attributionMcpTool: 'query' },
      }),
    ]);
    const [request] = (await parseTranscript(file)).requests;
    expect(request!.effort).toBe('xhigh');
    expect(request!.attribution).toEqual({ skill: 'code-review', plugin: 'security-review', mcpServer: 'grafana', mcpTool: 'query' });
  });

  it('flags aborted-mid-stream lines', async () => {
    const file = await tempTranscript([
      userLine('go'),
      assistantLine({ id: 'm1', model: 'claude-opus-5', content: [], usage: usage({ output: 1 }), extra: { isAbortedMidStream: true } }),
    ]);
    expect((await parseTranscript(file)).requests[0]!.isAbortedMidStream).toBe(true);
  });
});

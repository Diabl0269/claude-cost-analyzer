import { describe, expect, it } from 'vitest';
import { discoverSessions } from '../../../core/discover.js';
import { parseSession } from '../../../core/parse/index.js';
import { A2, FIXTURE_ROOT, LEGACY_ROOT } from './helpers.js';

async function session(root: string, sessionId: string) {
  const sessions = await discoverSessions([root]);
  const found = sessions.find((s) => s.sessionId === sessionId);
  if (!found) throw new Error(`fixture session ${sessionId} not found`);
  return parseSession(found);
}

describe('parseSession', () => {
  it('parses the main transcript, its agents and its workflow agents', async () => {
    const parsed = await session(FIXTURE_ROOT, A2);
    expect(parsed.main.agentId).toBeNull();
    expect(parsed.main.requests).toHaveLength(4);
    expect(parsed.agents.map((a) => a.agentId)).toEqual([
      'b1000000000000001', 'b2000000000000002', 'b3000000000000003',
    ]);
    expect(parsed.agents.map((a) => a.requests.length)).toEqual([2, 1, 1]);
    expect(parsed.agents.every((a) => a.facts === undefined)).toBe(true);
    expect(parsed.workflowRuns).toHaveLength(1);
    expect(parsed.workflowRuns[0]!.runId).toBe('wf_test1');
    expect(parsed.workflowRuns[0]!.agents.map((a) => a.agentId)).toEqual([
      'c1000000000000001', 'c2000000000000002',
    ]);
    expect(parsed.workflowRuns[0]!.journal).toEqual({ started: 2, result: 1, failed: 1 });
  });

  it('loads agent meta for both plain and workflow agents, including the nested one', async () => {
    const parsed = await session(FIXTURE_ROOT, A2);
    expect(Object.keys(parsed.agentMeta).sort()).toEqual([
      'b1000000000000001', 'b2000000000000002', 'b3000000000000003',
      'c1000000000000001', 'c2000000000000002',
    ]);
    expect(parsed.agentMeta['b1000000000000001']).toEqual({
      agentType: 'general-purpose', description: 'Trace build failure',
      toolUseId: 'toolu_a2_agent_sync', spawnDepth: 1, model: 'sonnet',
    });
    expect(parsed.agentMeta['b3000000000000003']).toMatchObject({
      parentAgentId: 'b1000000000000001', spawnDepth: 2, model: 'haiku',
    });
  });

  it('reads custom-title.json into customTitleFromFile', async () => {
    const parsed = await session(FIXTURE_ROOT, 'a3333333-3333-4333-8333-333333333333');
    expect(parsed.customTitleFromFile).toBe('Compaction and fallback');
    const a2 = await session(FIXTURE_ROOT, A2);
    expect(a2.customTitleFromFile).toBeUndefined();
  });

  it('splits legacy embedded sidechains out of the main transcript and into agents', async () => {
    const parsed = await session(LEGACY_ROOT, 'd1111111-1111-4111-8111-111111111111');
    expect(parsed.main.meta.parseErrors).toBe(1);
    // The embedded agent's request is not part of the main transcript's own totals.
    expect(parsed.main.requests.map((r) => r.messageId)).toEqual(['msg_d1r1']);
    expect(parsed.main.messages.map((m) => m.seq)).toEqual([0, 1, 5]);

    const embedded = parsed.main.embeddedAgents!;
    expect(Object.keys(embedded)).toEqual(['e1000000000000001']);
    expect(embedded['e1000000000000001']!.requests.map((r) => r.messageId)).toEqual(['msg_e1r1']);
    // seq stays the physical line index of the main file, so byte ranges keep working.
    expect(embedded['e1000000000000001']!.requests[0]!.seq).toBe(4);

    expect(parsed.agents.map((a) => a.agentId)).toEqual(['e2000000000000002', 'e1000000000000001']);
    expect(parsed.agents[1]).toBe(embedded['e1000000000000001']);
    expect(parsed.agentMeta['e2000000000000002']?.description).toBe('Legacy project-level agent');
  });

  it('leaves embeddedAgents undefined when a main file has no sidechain lines', async () => {
    const parsed = await session(FIXTURE_ROOT, A2);
    expect(parsed.main.embeddedAgents).toBeUndefined();
  });
});

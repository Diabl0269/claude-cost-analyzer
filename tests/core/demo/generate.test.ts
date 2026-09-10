/**
 * The demo generator is only useful if it is reproducible and if the app accepts what it writes,
 * so these tests assert exactly that: same seed → same bytes, discovery + parse with no warnings,
 * every feature a demo needs present at least once, and no path from the author's machine in the
 * output.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDemoTree, writeDemoTree, type DemoTree } from '../../../core/demo/generate.js';
import { discoverSessionsWithWarnings } from '../../../core/discover.js';
import { parseSession } from '../../../core/parse/index.js';
import { deltaPct, reportedTokenClasses, type TokenClassTotals } from '../../../core/cost/reported.js';
import type { ParsedSession, ParsedTranscript } from '../../../core/types.js';

/** Fixed clock: the dataset must not depend on when the test runs. */
const NOW = Date.parse('2026-09-09T18:00:00.000Z');
const SESSIONS = 14;
const OPTIONS = { seed: 4242, now: NOW, sessions: SESSIONS } as const;

/** Stable byte-for-byte serialization of a tree, for the determinism assertions. */
function serialize(tree: DemoTree): string {
  return [...tree.files].map(([p, text]) => `--- ${p}\n${text}`).join('');
}

describe('buildDemoTree', () => {
  it('is deterministic: the same seed and clock produce identical bytes', () => {
    const a = buildDemoTree(OPTIONS);
    const b = buildDemoTree(OPTIONS);
    expect([...b.files.keys()]).toEqual([...a.files.keys()]);
    expect(serialize(b)).toBe(serialize(a));
    expect(b.summary).toEqual(a.summary);
  });

  it('produces a different dataset for a different seed', () => {
    const a = buildDemoTree(OPTIONS);
    const b = buildDemoTree({ ...OPTIONS, seed: 4243 });
    expect(serialize(b)).not.toBe(serialize(a));
    expect(b.summary.sessions).toBe(a.summary.sessions);
  });

  it('stays inside plausible bounds', () => {
    const { summary } = buildDemoTree(OPTIONS);
    expect(summary.sessions).toBe(SESSIONS);
    expect(summary.projects).toBeGreaterThanOrEqual(4);
    expect(summary.agents).toBeGreaterThanOrEqual(4);
    expect(summary.workflowRuns).toBeGreaterThanOrEqual(1);
    expect(summary.requests).toBeGreaterThan(SESSIONS * 5);
    expect(summary.totalUsd).toBeGreaterThan(20);
    expect(summary.firstDate < summary.lastDate).toBe(true);
  });

  it('contains one of every line shape a demo needs to show', () => {
    const tree = buildDemoTree(OPTIONS);
    const paths = [...tree.files.keys()];
    const all = serialize(tree);

    expect(paths.some((p) => /\/subagents\/agent-[0-9a-f]+\.jsonl$/.test(p))).toBe(true);
    expect(paths.some((p) => /\/subagents\/agent-[0-9a-f]+\.meta\.json$/.test(p))).toBe(true);
    expect(paths.some((p) => /\/subagents\/workflows\/wf_[0-9a-f]+\/journal\.jsonl$/.test(p))).toBe(true);
    expect(paths.some((p) => p.endsWith('/custom-title.json'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/sessions-index.json'))).toBe(true);
    expect(paths.some((p) => p.startsWith('-Users-dev-oss-tinyvec--claude-worktrees-'))).toBe(true);
    expect(paths.some((p) => p.startsWith('-private-tmp-scratch/'))).toBe(true);

    for (const needle of [
      '"type":"hook_success"',
      '"type":"hook_additional_context"',
      '"type":"hook_blocking_error"',
      '"subtype":"stop_hook_summary"',
      '"subtype":"turn_duration"',
      '"subtype":"compact_boundary"',
      '"subtype":"api_error"',
      '"isCompactSummary":true',
      '"type":"fallback_message"',
      '"speed":"fast"',
      '"type":"ai-title"',
      '"type":"custom-title"',
      '"type":"agent-name"',
      '"type":"cost-state"',
      '"type":"pr-link"',
      '"type":"continued-in"',
      '"model":"<synthetic>"',
      '"ephemeral_1h_input_tokens"',
      '"thinking_tokens"',
      '"web_search_requests":1',
      '"type":"image"',
      '"rendered"',
      '"name":"Agent"',
      '"name":"Workflow"',
      '"name":"Skill"',
      'mcp__github__list_pull_requests',
    ]) {
      expect(all, `missing ${needle}`).toContain(needle);
    }
  });

  it('never leaks a path from this machine', () => {
    const tree = buildDemoTree(OPTIONS);
    const text = [...tree.files.keys()].join('\n') + serialize(tree);
    const foreign = [...text.matchAll(/\/Users\/[A-Za-z0-9._-]*/g)]
      .map((m) => m[0])
      .filter((p) => p !== '/Users/dev');
    expect([...new Set(foreign)]).toEqual([]);
  });
});

describe('the generated tree, read back through discovery and parsing', () => {
  let root = '';
  let sessions: ParsedSession[] = [];

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cca-demo-'));
    const tree = buildDemoTree(OPTIONS);
    await writeDemoTree(tree, path.join(root, 'projects'));
    const { sessions: discovered, warnings } = await discoverSessionsWithWarnings([path.join(root, 'projects')]);
    expect(warnings).toEqual([]);
    sessions = await Promise.all(discovered.map((d) => parseSession(d)));
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('discovers every session with no warnings and no malformed lines', () => {
    expect(sessions).toHaveLength(SESSIONS);
    for (const session of sessions) {
      for (const transcript of transcriptsOf(session)) {
        expect(transcript.meta.parseErrors, transcript.file.path).toBe(0);
        expect(transcript.meta.lineCount).toBeGreaterThan(0);
      }
    }
  });

  it('gives every session a title, a first prompt and a cost-state oracle', () => {
    for (const session of sessions) {
      expect(session.main.facts?.aiTitle ?? session.customTitleFromFile).toBeTruthy();
      expect(session.main.facts?.firstPrompt).toBeTruthy();
      expect(session.main.facts?.reportedCost).toBeDefined();
    }
  });

  it('writes cost-state lines that agree with the transcript, bar the planned divergences', () => {
    let matching = 0;
    for (const session of sessions) {
      const reported = session.main.facts?.reportedCost;
      if (!reported) continue;
      const computed = tokenClassesOf(session);
      const rep = reportedTokenClasses(reported);
      const agrees = (['input', 'output', 'cacheRead', 'cacheWrite'] as const).every(
        (key) => Math.abs(deltaPct(computed[key], rep[key])) <= 5,
      );
      if (agrees) matching += 1;
    }
    // Three sessions carry a deliberate offset (resumed / forked / hidden background calls).
    expect(matching).toBeGreaterThanOrEqual(SESSIONS - 3);
  });

  it('links every Agent and Workflow tool call it claims a child for', () => {
    const agentIds = new Set<string>();
    const runIds = new Set<string>();
    let agentCalls = 0;
    let workflowCalls = 0;
    for (const session of sessions) {
      for (const transcript of transcriptsOf(session)) {
        if (transcript.agentId) agentIds.add(transcript.agentId);
      }
      for (const run of session.workflowRuns) runIds.add(run.runId);
    }
    for (const session of sessions) {
      for (const transcript of transcriptsOf(session)) {
        for (const call of transcript.toolCalls) {
          if (call.childAgentId) {
            agentCalls += 1;
            expect(agentIds.has(call.childAgentId), call.childAgentId).toBe(true);
          }
          if (call.childRunId) {
            workflowCalls += 1;
            expect(runIds.has(call.childRunId), call.childRunId).toBe(true);
          }
        }
      }
    }
    expect(agentCalls).toBeGreaterThan(0);
    expect(workflowCalls).toBeGreaterThan(0);
  });

  it('records hooks, injections, compactions and a nested subagent', () => {
    let hookRuns = 0;
    let injections = 0;
    let compactions = 0;
    let nested = 0;
    for (const session of sessions) {
      for (const transcript of transcriptsOf(session)) {
        hookRuns += transcript.hooks.length;
        injections += transcript.injections.length;
        compactions += transcript.compactions.length;
      }
      nested += Object.values(session.agentMeta).filter((m) => (m.spawnDepth ?? 1) > 1).length;
    }
    expect(hookRuns).toBeGreaterThan(SESSIONS);
    expect(injections).toBeGreaterThan(SESSIONS * 5);
    expect(compactions).toBeGreaterThanOrEqual(1);
    expect(nested).toBeGreaterThanOrEqual(1);
  });
});

function transcriptsOf(session: ParsedSession): ParsedTranscript[] {
  return [session.main, ...session.agents, ...session.workflowRuns.flatMap((run) => run.agents)];
}

/** Σ billed tokens over every transcript of a session, iterations billed one by one. */
function tokenClassesOf(session: ParsedSession): TokenClassTotals {
  const totals: TokenClassTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const transcript of transcriptsOf(session)) {
    for (const request of transcript.requests) {
      if (request.isSynthetic) continue;
      const units = request.iterations ? request.iterations.map((i) => i.usage) : [request.usage];
      for (const usage of units) {
        totals.input += usage.input;
        totals.output += usage.output;
        totals.cacheRead += usage.cacheRead;
        totals.cacheWrite += usage.cache5m + usage.cache1h;
      }
    }
  }
  return totals;
}

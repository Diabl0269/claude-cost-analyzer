import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSessions, discoverSessionsWithWarnings, expandHome } from '../../../core/discover.js';
import { A1, A2, A3, FIXTURE_ROOT, LEGACY_ROOT } from './helpers.js';

describe('discoverSessions', () => {
  it('groups every main file, subagent and workflow run of the fixture root', async () => {
    const { sessions, warnings } = await discoverSessionsWithWarnings([FIXTURE_ROOT]);
    expect(warnings).toEqual([]);
    expect(sessions.map((s) => `${s.projectDirName}/${s.sessionId}`)).toEqual([
      `-Users-dev-projects-alpha/${A1}`,
      `-Users-dev-projects-alpha/${A2}`,
      `-Users-dev-projects-alpha/${A3}`,
      '-Users-dev-projects-alpha--claude-worktrees-feature-x/b1111111-1111-4111-8111-111111111111',
      '-private-var-folders-zz-T/c1111111-1111-4111-8111-111111111111',
    ]);

    const a2 = sessions.find((s) => s.sessionId === A2)!;
    expect(a2.agentFiles.map((f) => f.agentId)).toEqual([
      'b1000000000000001',
      'b2000000000000002',
      'b3000000000000003',
    ]);
    expect(a2.agentFiles.every((f) => f.kind === 'subagent' && f.metaPath?.endsWith('.meta.json'))).toBe(true);
    expect(a2.agentFiles[0]!.size).toBeGreaterThan(0);
    expect(a2.workflowRuns).toHaveLength(1);
    expect(a2.workflowRuns[0]!.runId).toBe('wf_test1');
    expect(a2.workflowRuns[0]!.journalPath).toMatch(/journal\.jsonl$/);
    expect(a2.workflowRuns[0]!.agentFiles.map((f) => f.agentId)).toEqual([
      'c1000000000000001',
      'c2000000000000002',
    ]);
    expect(a2.workflowRuns[0]!.agentFiles.every((f) => f.kind === 'workflow-agent' && f.runId === 'wf_test1')).toBe(true);
  });

  it('skips memory/, tool-results/ and workflows/scripts', async () => {
    const sessions = await discoverSessions([FIXTURE_ROOT]);
    const paths = sessions.flatMap((s) => [
      s.mainFile.path,
      ...s.agentFiles.map((f) => f.path),
      ...s.workflowRuns.flatMap((r) => r.agentFiles.map((f) => f.path)),
    ]);
    expect(paths.some((p) => p.includes(`${path.sep}memory${path.sep}`))).toBe(false);
    expect(paths.some((p) => p.includes(`${path.sep}tool-results${path.sep}`))).toBe(false);
    expect(paths.some((p) => p.includes(`${path.sep}workflows${path.sep}scripts${path.sep}`))).toBe(false);
    expect(paths.every((p) => p.endsWith('.jsonl'))).toBe(true);
  });

  it('picks up custom-title.json and the sessions-index entry', async () => {
    const sessions = await discoverSessions([FIXTURE_ROOT]);
    const a3 = sessions.find((s) => s.sessionId === A3)!;
    expect(a3.customTitlePath).toMatch(/custom-title\.json$/);
    expect(a3.indexEntry?.summary).toBe('Compaction, fallback and retry');
    expect(a3.indexEntry?.projectPath).toBe('/Users/dev/projects/alpha');
    const a1 = sessions.find((s) => s.sessionId === A1)!;
    expect(a1.customTitlePath).toBeUndefined();
    expect(a1.indexEntry?.messageCount).toBe(30);
  });

  it('attaches legacy project-level agent files by their sessionId and warns about orphans', async () => {
    const { sessions, warnings } = await discoverSessionsWithWarnings([LEGACY_ROOT]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.agentFiles.map((f) => f.agentId)).toEqual(['e2000000000000002']);
    expect(sessions[0]!.agentFiles[0]!.metaPath).toMatch(/agent-e2000000000000002\.meta\.json$/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toMatch(/agent-e3000000000000003\.jsonl$/);
    expect(warnings[0]!.message).toMatch(/derivable sessionId/);
  });

  it('never throws on a missing root; it warns instead', async () => {
    const { sessions, warnings } = await discoverSessionsWithWarnings([
      path.join(FIXTURE_ROOT, 'does-not-exist'),
    ]);
    expect(sessions).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/ENOENT/);
  });

  it('expands a leading ~', () => {
    expect(expandHome('~/x')).toMatch(/^\/.+\/x$/);
    expect(expandHome('/absolute/path')).toBe('/absolute/path');
    expect(expandHome('relative/~/path')).toBe('relative/~/path');
  });
});

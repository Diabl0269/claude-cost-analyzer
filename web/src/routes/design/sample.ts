/**
 * Invented data for the component gallery. Nothing here comes from a real transcript;
 * the numbers are plausible so the components can be judged at realistic sizes.
 */
import type { TokenClassKey } from '@/lib/chart';
import type { WaterfallDatum } from '@/components/CostWaterfall';
import type { HeatDay } from '@/components/HeatStrip';
import type { ContextSegment } from '@/components/ContextStrip';
import type { TreeNode } from '@/components/TreeNav';

/** Deterministic pseudo-random so the gallery looks the same on every render. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export interface SampleSession {
  id: string;
  title: string;
  project: string;
  startedAt: string;
  durationMs: number;
  models: string[];
  prompts: number;
  requests: number;
  cost: number;
  reportedDelta: number;
  pinned: boolean;
}

export const SAMPLE_SESSIONS: SampleSession[] = [
  {
    id: '3a182479-b9d0-45d5-90d0-293a70bda11c',
    title: 'Refactor billing webhooks',
    project: 'payments-gateway',
    startedAt: '2026-09-06T09:12:00Z',
    durationMs: 4 * 3600_000 + 12 * 60_000,
    models: ['claude-opus-5', 'claude-haiku-4-5'],
    prompts: 64,
    requests: 412,
    cost: 143.5062,
    reportedDelta: 0.004,
    pinned: true,
  },
  {
    id: '9f2c1d77-2b40-4a51-8f0e-77b9d2f4a010',
    title: 'Trace flaky checkout test',
    project: 'storefront',
    startedAt: '2026-09-06T13:40:00Z',
    durationMs: 51 * 60_000,
    models: ['claude-sonnet-5'],
    prompts: 18,
    requests: 96,
    cost: 6.2841,
    reportedDelta: -0.011,
    pinned: false,
  },
  {
    id: 'd41ba0c5-5c98-4f1e-9f2a-1c2e77bb3f61',
    title: 'Draft the Q4 pricing memo',
    project: 'ops-notes',
    startedAt: '2026-09-05T18:02:00Z',
    durationMs: 2 * 3600_000 + 5 * 60_000,
    models: ['claude-fable-5-1', 'claude-opus-5'],
    prompts: 31,
    requests: 187,
    cost: 88.104,
    reportedDelta: 0.062,
    pinned: false,
  },
  {
    id: '55e0a1f3-77cd-4b0a-bb61-2f0c9a6e7d12',
    title: 'Migrate cron jobs to the scheduler',
    project: 'platform-infra',
    startedAt: '2026-09-05T08:20:00Z',
    durationMs: 3 * 3600_000 + 40 * 60_000,
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    prompts: 47,
    requests: 298,
    cost: 61.7723,
    reportedDelta: 0.002,
    pinned: false,
  },
  {
    id: '0b7e9d2a-3c14-4a7b-9f55-6e1d0c4b8a93',
    title: 'Rename the helper in utils.ts',
    project: 'storefront',
    startedAt: '2026-09-04T16:55:00Z',
    durationMs: 6 * 60_000,
    models: ['claude-haiku-4-5'],
    prompts: 3,
    requests: 11,
    cost: 0.0068,
    reportedDelta: 0,
    pinned: false,
  },
  {
    id: 'c7a3f0d1-9b62-40de-b3f7-51a8e2c9d004',
    title: 'Audit the release checklist workflow',
    project: 'platform-infra',
    startedAt: '2026-09-03T11:05:00Z',
    durationMs: 78 * 60_000,
    models: ['claude-sonnet-5', 'claude-mythos-5-1'],
    prompts: 22,
    requests: 134,
    cost: 24.9017,
    reportedDelta: 0.118,
    pinned: false,
  },
];

/** A longer list to exercise virtualization (> 200 rows). */
export const MANY_SESSIONS: SampleSession[] = Array.from({ length: 480 }, (_, index) => {
  const random = seeded(index + 7);
  const base = SAMPLE_SESSIONS[index % SAMPLE_SESSIONS.length];
  if (!base) throw new Error('sample sessions must not be empty');
  const scale = 0.2 + random() * 3;
  return {
    ...base,
    id: `${base.id.slice(0, 8)}-${String(index).padStart(4, '0')}`,
    title: `${base.title} · run ${index + 1}`,
    cost: Number((base.cost * scale).toFixed(4)),
    requests: Math.round(base.requests * scale),
    prompts: Math.max(1, Math.round(base.prompts * scale)),
    durationMs: Math.round(base.durationMs * scale),
    pinned: false,
  };
});

export const SAMPLE_WATERFALL: WaterfallDatum[] = Array.from({ length: 48 }, (_, index) => {
  const random = seeded(index * 31 + 5);
  const model = index % 9 === 0 ? 'claude-haiku-4-5' : index % 5 === 0 ? 'claude-sonnet-5' : 'claude-opus-5';
  const scale = model === 'claude-opus-5' ? 1 : model === 'claude-sonnet-5' ? 0.4 : 0.12;
  const segments: Partial<Record<TokenClassKey, number>> = {
    output: Number((0.02 + random() * 0.35 * scale).toFixed(5)),
    input: Number((0.001 + random() * 0.02 * scale).toFixed(5)),
    cacheWrite: Number((random() > 0.7 ? random() * 0.42 * scale : random() * 0.05 * scale).toFixed(5)),
    cacheRead: Number((0.01 + random() * 0.24 * scale).toFixed(5)),
  };
  const total = Object.values(segments).reduce((sum, value) => sum + (value ?? 0), 0);
  return {
    seq: index * 3 + 4,
    ts: new Date(Date.UTC(2026, 8, 6, 9, 12 + index * 4)).toISOString(),
    model,
    segments,
    total: Number(total.toFixed(5)),
  };
});

export const SAMPLE_DAYS: HeatDay[] = Array.from({ length: 30 }, (_, index) => {
  const random = seeded(index * 17 + 3);
  const day = new Date(2026, 7, 9 + index);
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const cost = weekend ? random() * 3 : 4 + random() * 46;
  return {
    date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    cost: Number(cost.toFixed(4)),
    requests: Math.round(cost * 7),
    sessions: Math.max(1, Math.round(cost / 9)),
  };
});

export const SAMPLE_CONTEXT: ContextSegment[] = [
  { id: 'system', label: 'System prompt', tokens: 18420, cost: 0.092, color: 'var(--m-opus)' },
  { id: 'harness', label: 'Harness injections', tokens: 24160, cost: 0.121, color: 'var(--t-cache-write)', pattern: 'hatch' },
  { id: 'prompts', label: 'Your prompts', tokens: 6280, cost: 0.031, color: 'var(--m-sonnet)' },
  { id: 'output', label: 'Assistant output', tokens: 31840, cost: 0.159, color: 'var(--t-output)' },
  { id: 'tools', label: 'Tool results', tokens: 68210, cost: 0.341, color: 'var(--t-cache-read)', pattern: 'dots' },
  { id: 'hooks', label: 'Hook context', tokens: 9120, cost: 0.046, color: 'var(--m-haiku)' },
];

export const SAMPLE_TOKENS = {
  input: 41_204,
  output: 318_902,
  cache5m: 1_204_882,
  cache1h: 402_119,
  cacheRead: 8_942_006,
};

export const SAMPLE_PROJECT_TREE: TreeNode[] = [
  {
    id: 'platform-infra',
    label: 'platform-infra',
    text: 'platform-infra',
    children: [
      { id: 'platform-infra-wt-1', label: 'worktrees/PROJ-1234', text: 'worktrees/PROJ-1234', icon: 'workflow' },
      { id: 'platform-infra-wt-2', label: 'worktrees/PROJ-1235', text: 'worktrees/PROJ-1235', icon: 'workflow' },
    ],
  },
  { id: 'payments-gateway', label: 'payments-gateway', text: 'payments-gateway' },
  { id: 'storefront', label: 'storefront', text: 'storefront' },
  { id: 'ops-notes', label: 'ops-notes', text: 'ops-notes' },
];

export interface SampleTool {
  name: string;
  calls: number;
  errors: number;
  resultChars: number;
  genCost: number;
  ingestCost: number;
  carryCost: number;
  childCost: number;
}

export const SAMPLE_TOOLS: SampleTool[] = [
  { name: 'Read', calls: 412, errors: 3, resultChars: 8_120, genCost: 0.94, ingestCost: 4.12, carryCost: 18.44, childCost: 0 },
  { name: 'Bash', calls: 388, errors: 41, resultChars: 2_940, genCost: 1.21, ingestCost: 2.02, carryCost: 9.87, childCost: 0 },
  { name: 'Edit', calls: 208, errors: 12, resultChars: 640, genCost: 3.44, ingestCost: 0.51, carryCost: 2.18, childCost: 0 },
  { name: 'Agent', calls: 34, errors: 1, resultChars: 12_400, genCost: 0.62, ingestCost: 1.94, carryCost: 6.02, childCost: 41.28 },
  { name: 'Grep', calls: 166, errors: 0, resultChars: 3_180, genCost: 0.38, ingestCost: 0.92, carryCost: 4.11, childCost: 0 },
  { name: 'mcp__grafana-sso__query_prometheus', calls: 24, errors: 2, resultChars: 21_800, genCost: 0.11, ingestCost: 1.34, carryCost: 5.62, childCost: 0 },
  { name: 'Workflow', calls: 6, errors: 0, resultChars: 4_120, genCost: 0.08, ingestCost: 0.22, carryCost: 0.71, childCost: 22.9 },
];

export const SAMPLE_SPARK = [3.2, 4.1, 2.8, 6.4, 9.1, 7.7, 12.4, 10.2, 14.8, 13.1, 18.4, 21.9];

/** Fixed timestamps so the index-status pill renders identically in every screenshot. */
export const SAMPLE_INDEX_STARTED_AT = '2026-09-07T12:03:11.000Z';
export const SAMPLE_INDEXED_AT = '2026-09-07T12:04:38.000Z';

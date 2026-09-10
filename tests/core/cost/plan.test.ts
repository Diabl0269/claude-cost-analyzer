import { describe, expect, it } from 'vitest';
import { budgetStatus, localDateKey, monthKeyOf, planComparison } from '../../../core/cost/plan.js';
import { applyPlanPreset, defaultSettings } from '../../../core/settings.js';
import { computeInsights, type InsightsInput } from '../../../core/cost/insights.js';
import { defaultPricing } from '../../../core/pricing/defaults.js';
import { usage } from './builders.js';

const daily = [
  { date: '2026-08-30', cost: 4 },
  { date: '2026-08-31', cost: 6 },
  { date: '2026-09-01', cost: 10 },
  { date: '2026-09-02', cost: 20 },
  { date: '2026-09-05', cost: 30 },
];

describe('planComparison', () => {
  it('groups by calendar month and compares against the plan price', () => {
    const settings = applyPlanPreset(defaultSettings(), 'max20');
    const comparison = planComparison(daily, settings);
    expect(comparison.monthlyUsd).toBe(200);
    expect(comparison.months).toEqual([
      { month: '2026-08', apiCost: 10, planCost: 200, delta: -190 },
      { month: '2026-09', apiCost: 60, planCost: 200, delta: -140 },
    ]);
  });

  it('reports a positive delta when the API bill beats the subscription', () => {
    const settings = applyPlanPreset(defaultSettings(), 'pro');
    const months = planComparison(daily, settings).months;
    expect(months.find((m) => m.month === '2026-09')?.delta).toBe(40);
  });

  it('handles an empty range', () => {
    expect(planComparison([], defaultSettings()).months).toEqual([]);
  });
});

describe('budgetStatus', () => {
  it('forecasts month end from the run rate so far', () => {
    const settings = { ...defaultSettings(), monthlyBudgetUsd: 100 };
    const status = budgetStatus(daily, settings, new Date(2026, 8, 6, 12));
    expect(status.month).toBe('2026-09');
    expect(status.spent).toBe(60);
    expect(status.daysElapsed).toBe(6);
    expect(status.daysInMonth).toBe(30);
    expect(status.forecast).toBeCloseTo(300, 9);
    expect(status.monthlyBudgetUsd).toBe(100);
  });

  it('ignores other months', () => {
    const status = budgetStatus(daily, defaultSettings(), new Date(2026, 7, 31, 9));
    expect(status.spent).toBe(10);
    expect(status.daysInMonth).toBe(31);
  });
});

describe('date keys', () => {
  it('formats local dates without a timezone shift', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(monthKeyOf('2026-01-05')).toBe('2026-01');
  });
});

describe('computeInsights', () => {
  const ctx = { pricing: defaultPricing(), settings: defaultSettings() };

  function input(partial: Partial<InsightsInput> = {}): InsightsInput {
    return {
      totalCost: 100,
      sessions: [],
      sessionModels: [],
      tools: [],
      hooks: [],
      harnessCost: 0,
      hookCost: 0,
      ...partial,
    };
  }

  it('returns nothing when there is nothing to say', () => {
    expect(computeInsights(input(), ctx)).toEqual([]);
  });

  it('ranks the most expensive tool carry cost first', () => {
    const insights = computeInsights(
      input({
        tools: [
          { name: 'Read', calls: 40, genCost: 1, ingestCost: 2, carryCost: 30, topSessions: [] },
          { name: 'Bash', calls: 10, genCost: 1, ingestCost: 1, carryCost: 3, topSessions: [] },
        ],
      }),
      ctx,
    );
    expect(insights[0]?.id).toBe('tool-carry-cost');
    expect(insights[0]?.impactUsd).toBe(30);
    expect(insights[0]?.title).toContain('Read');
  });

  it('caps affected sessions at five, highest impact first', () => {
    const sessions = Array.from({ length: 9 }, (_, i) => ({
      sessionId: `s${i}`,
      title: `Session ${i}`,
      projectId: 'p',
      projectPath: '/repo',
      cost: 1,
      promptCount: 1,
      requestCount: 1,
      contextTokensTotal: 1,
      compactionCount: 1,
      rewarmCost: i,
      coldCacheRequests: 0,
      coldCacheCost: 0,
      idleGapExpiries: 0,
      idleGapCost: 0,
    }));
    const insight = computeInsights(input({ sessions }), ctx).find((i) => i.id === 'compaction-rewarm');
    expect(insight?.sessions).toHaveLength(5);
    expect(insight?.sessions[0]?.sessionId).toBe('s8');
  });

  it('prices a Fable → Opus 5 swap from stored usage', () => {
    const insights = computeInsights(
      input({
        sessionModels: [
          {
            sessionId: 's1',
            title: 'Refactor',
            model: 'claude-fable-5',
            family: 'fable',
            isAgent: false,
            requests: 3,
            cost: (1_000_000 * 10) / 1e6,
            usage: usage({ input: 1_000_000 }),
          },
        ],
      }),
      ctx,
    );
    const swap = insights.find((i) => i.id === 'model-mix-fable-to-opus');
    expect(swap?.impactUsd).toBeCloseTo(5, 9);
    expect(swap?.kind).toBe('saving');
  });

  it('reports long-context sessions above 150K average', () => {
    const insight = computeInsights(
      input({
        sessions: [
          {
            sessionId: 's1',
            title: 'Long haul',
            projectId: 'p',
            projectPath: '/repo',
            cost: 40,
            promptCount: 20,
            requestCount: 10,
            contextTokensTotal: 2_000_000,
            compactionCount: 0,
            rewarmCost: 0,
            coldCacheRequests: 0,
            coldCacheCost: 0,
            idleGapExpiries: 0,
            idleGapCost: 0,
          },
        ],
      }),
      ctx,
    ).find((i) => i.id === 'long-context-sessions');
    expect(insight?.impactUsd).toBe(40);
    expect(insight?.metric?.value).toBe('200.0k');
  });

  it('sorts money findings ahead of informational ones', () => {
    const insights = computeInsights(
      input({
        harnessCost: 90,
        hookCost: 5,
        tools: [{ name: 'Read', calls: 1, genCost: 0, ingestCost: 0, carryCost: 1, topSessions: [] }],
      }),
      ctx,
    );
    const kinds = insights.map((i) => i.kind);
    expect(kinds.indexOf('info')).toBeGreaterThan(kinds.lastIndexOf('waste'));
  });
});

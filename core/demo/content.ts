/**
 * Fictional content pools for the demo data generator.
 *
 * Everything in this file is invented. The workspace ("Lumen", "tinyvec"), the people, the file
 * paths, the hook names and the MCP servers do not exist; no string here was copied from a real
 * transcript, and the generator never reads `~/.claude`. See `docs/dev/demo.md`.
 */

export interface DemoProject {
  /** `~/.claude/projects` directory name (cwd with `/` → `-`, dots dropped) */
  dirName: string;
  /** the cwd the transcripts claim; always under `/Users/dev` */
  cwd: string;
  /** git branches this project's sessions run on */
  branches: string[];
  /** relative share of sessions that land in this project */
  weight: number;
  /** short slug used in file paths inside prompts and tool inputs */
  slug: string;
}

export const DEMO_PROJECTS: DemoProject[] = [
  {
    dirName: '-Users-dev-work-lumen-api',
    cwd: '/Users/dev/work/lumen-api',
    branches: ['main', 'LUM-4417-retry-budget', 'LUM-4502-webhook-replay'],
    weight: 32,
    slug: 'lumen-api',
  },
  {
    dirName: '-Users-dev-work-lumen-web',
    cwd: '/Users/dev/work/lumen-web',
    branches: ['main', 'LUM-4488-usage-panel'],
    weight: 22,
    slug: 'lumen-web',
  },
  {
    dirName: '-Users-dev-work-lumen-infra',
    cwd: '/Users/dev/work/lumen-infra',
    branches: ['main', 'LUM-4390-cache-tier'],
    weight: 14,
    slug: 'lumen-infra',
  },
  {
    dirName: '-Users-dev-oss-tinyvec',
    cwd: '/Users/dev/oss/tinyvec',
    branches: ['main', 'bench-rework'],
    weight: 14,
    slug: 'tinyvec',
  },
  {
    dirName: '-Users-dev-oss-tinyvec--claude-worktrees-feat-quantize',
    cwd: '/Users/dev/oss/tinyvec/.claude/worktrees/feat-quantize',
    branches: ['feat-quantize'],
    weight: 8,
    slug: 'tinyvec',
  },
  {
    dirName: '-Users-dev-notes',
    cwd: '/Users/dev/notes',
    branches: ['main'],
    weight: 6,
    slug: 'notes',
  },
  {
    dirName: '-private-tmp-scratch',
    cwd: '/private/tmp/scratch',
    branches: ['main'],
    weight: 4,
    slug: 'scratch',
  },
];

/** Session titles, keyed by project slug. Each is used at most once per generated dataset. */
export const TITLES: Record<string, string[]> = {
  'lumen-api': [
    'Fix flaky retry test in payments worker',
    'Webhook replay drops the idempotency key',
    'Add a retry budget to the billing client',
    'Trace the 502s on the invoice export route',
    'Split the ledger service out of the monolith',
    'Idempotency keys collide across tenants',
    'Rate limiter counts preflight requests twice',
    'Backfill missing invoice line items',
    'Refund webhook fires before the charge settles',
    'Cut the p99 on /v1/usage from 900ms to 200ms',
    'Audit log misses tenant switches',
    'Migrate the payments queue to the new broker',
    'Pagination cursor breaks on deleted rows',
    'Add OpenAPI examples for the usage endpoints',
    'Stop double-charging on retried captures',
    'Harden the webhook signature check',
    'Investigate the nightly reconciliation drift',
    'Replace the ad-hoc SQL in the ledger reader',
    'Add a dead-letter queue for failed payouts',
    'Tighten the tenant scoping on the admin API',
  ],
  'lumen-web': [
    'Usage panel renders stale totals after a filter change',
    'Fix the focus trap in the billing modal',
    'Chart legend overflows on narrow viewports',
    'Add keyboard nav to the invoice table',
    'Dark theme contrast fails on the cost badges',
    'Debounce the project switcher search',
    'Virtualize the long invoice list',
    'Fix the hydration mismatch on the usage route',
    'Add empty and error states to the spend chart',
    'Currency formatting rounds down on the summary tile',
    'Sticky table header jumps on scroll',
    'Move the date range picker into a shared hook',
  ],
  'lumen-infra': [
    'Cache tier evicts hot keys during deploys',
    'Terraform plan drifts on the ingress module',
    'Tighten the CI cache key for the API build',
    'Autoscaler flaps between 3 and 9 replicas',
    'Add a canary stage to the payments deploy',
    'Rotate the broker credentials without downtime',
    'Cut the docker image from 1.4GB to 300MB',
    'Alerting misses the queue-depth spike',
  ],
  tinyvec: [
    'Quantize the index to 8 bits without losing recall',
    'Benchmark harness reports wrong QPS on warm runs',
    'SIMD path is slower than the scalar fallback',
    'Fix the mmap alignment bug on 32-bit targets',
    'Add a recall@10 regression test',
    'Document the on-disk index format',
    'Reduce allocations in the top-k heap',
    'Make the builder resumable after a crash',
  ],
  notes: [
    'Draft the Q4 platform reliability review',
    'Summarize the payments incident timeline',
    'Turn the migration notes into a runbook',
    'Write up the cache tier decision record',
  ],
  scratch: [
    'One-off script to diff two usage exports',
    'Poke at a JSON parsing edge case',
    'Quick check on a regex for semver ranges',
  ],
};

/** First prompts, keyed by project slug. */
export const PROMPTS: Record<string, string[]> = {
  'lumen-api': [
    'The retry test in the payments worker fails about one run in five. Find the race and fix it.',
    'Webhook replay is dropping the idempotency key somewhere between the queue and the handler. Trace it.',
    'Add a retry budget to the billing client so a single downstream outage cannot amplify traffic.',
    'We are seeing 502s on the invoice export route, but only for large tenants. Dig in.',
    'Plan how to split the ledger service out of the monolith without a dual-write window.',
    'Two tenants generated the same idempotency key and one payment was rejected. Explain how.',
    'The rate limiter seems to count preflight requests. Confirm and fix, with a test.',
    'Write a backfill for invoice line items missing between March and May.',
    'Read the capture path and tell me whether a retried capture can double-charge.',
    'Profile /v1/usage and get p99 under 200ms. Do not change the response shape.',
    'The audit log has no entry for tenant switches. Add one and cover it with a test.',
    'Draft the migration plan for moving the payments queue to the new broker.',
    'Pagination breaks when a row is deleted mid-scan. Reproduce it first, then fix it.',
    'Add request and response examples to the OpenAPI spec for the usage endpoints.',
    'Review the webhook signature check for timing leaks and replay windows.',
    'Nightly reconciliation is off by a few cents. Find where the rounding happens.',
    'Replace the hand-written SQL in the ledger reader with the query builder.',
    'Design a dead-letter queue for failed payouts and sketch the operator runbook.',
    'Check every admin endpoint for missing tenant scoping.',
    'Summarize what changed in the payments worker this week and what still needs review.',
  ],
  'lumen-web': [
    'The usage panel keeps showing stale totals after the date filter changes. Find the bug.',
    'Focus escapes the billing modal when you tab past the last button. Fix the trap.',
    'The chart legend overflows below 900px. Make it wrap without shifting the plot.',
    'Add full keyboard navigation to the invoice table, including range selection.',
    'The cost badges fail contrast in dark theme. Fix the tokens, not the components.',
    'Debounce the project switcher search and cancel in-flight requests.',
    'The invoice list renders 4000 rows. Virtualize it and keep the sticky header.',
    'There is a hydration mismatch on the usage route. Track down which node differs.',
    'The spend chart has no empty or error state. Add both, matching the design tokens.',
    'Summary tile rounds 1.995 down to 1.99. Decide on a rule and apply it everywhere.',
    'The sticky table header jumps by a pixel on scroll. Find out why.',
    'Extract the date range picker logic into a shared hook and cover it with tests.',
  ],
  'lumen-infra': [
    'The cache tier evicts hot keys during every deploy. Work out whether it is the warmup order.',
    'Terraform plan shows drift on the ingress module even with no changes. Explain it.',
    'Our CI cache key busts on every lockfile touch. Make it narrower but still correct.',
    'The autoscaler flaps between 3 and 9 replicas each afternoon. Read the metrics and propose limits.',
    'Add a canary stage to the payments deploy with an automatic rollback rule.',
    'Write the runbook for rotating broker credentials with no downtime.',
    'The API image is 1.4GB. Get it under 400MB without changing the base distro.',
    'We missed a queue-depth spike overnight. Fix the alerting rule and prove it fires.',
  ],
  tinyvec: [
    'Quantize the index to 8 bits and measure recall@10 before and after.',
    'The benchmark harness reports different QPS on warm runs. Find the measurement bug.',
    'The SIMD search path is slower than the scalar one on my machine. Profile both.',
    'mmap fails to align on 32-bit targets. Reproduce with a small test and fix it.',
    'Add a recall regression test that fails if recall@10 drops more than one point.',
    'Document the on-disk index format, including the version header and padding rules.',
    'Reduce allocations in the top-k heap. Keep the API unchanged.',
    'Make the index builder resumable after a crash halfway through a shard.',
  ],
  notes: [
    'Turn my scattered reliability notes into a Q4 review with three concrete asks.',
    'Summarize the payments incident into a timeline with owners and follow-ups.',
    'Rewrite the migration notes as a runbook a new on-call could follow.',
    'Write a decision record for the cache tier choice, including what we rejected.',
  ],
  scratch: [
    'Write a one-off script that diffs two usage exports and prints only the changed rows.',
    'Why does this JSON parse succeed with a trailing comma in one library and not the other?',
    'Check whether this regex handles semver prerelease ranges correctly.',
  ],
};

/** Follow-up prompts, reused across projects. */
export const FOLLOW_UPS: string[] = [
  'Good. Now add a regression test that would have caught this.',
  'Show me the diff before you touch anything else.',
  'That looks right, but check the error path too.',
  'Run the tests and paste only the failures.',
  'Keep going, and stop if you need a decision from me.',
  'Can you do the same thing for the sibling module?',
  'Explain the tradeoff in two sentences, then pick one.',
  'Revert that last edit and try the simpler approach.',
  'Now write the commit message.',
  'What did you not check?',
  'Update the docs to match.',
  'Is there anywhere else with the same pattern?',
  'Make the log line say what it counted, not what it did.',
  'Do it, but do not add a dependency.',
];

export const HOOK_NAMES: { hookName: string; hookEvent: string; command: string }[] = [
  { hookName: 'PostToolUse:Edit', hookEvent: 'PostToolUse', command: './scripts/format-on-edit.sh' },
  { hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', command: './scripts/policy-check.sh' },
  { hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', command: './scripts/inject-conventions.sh' },
  { hookName: 'SessionStart:startup', hookEvent: 'SessionStart', command: './scripts/session-start.sh' },
  { hookName: 'Stop:notify', hookEvent: 'Stop', command: './scripts/notify-stop.sh' },
];

export const SKILLS: string[] = ['lumen-release', 'incident-writeup', 'bench-compare', 'runbook-check'];

export const PLUGINS: string[] = ['lumen-tools', 'vecbench'];

export const MCP_TOOLS: string[] = ['mcp__github__list_pull_requests', 'mcp__linear__search_issues'];

export const AGENT_TYPES: string[] = [
  'general-purpose',
  'code-reviewer',
  'test-writer',
  'doc-writer',
  'perf-investigator',
];

export const AGENT_DESCRIPTIONS: string[] = [
  'Trace the retry race',
  'Review the queue handler',
  'Write the regression test',
  'Map every caller of the ledger reader',
  'Summarize the profiler output',
  'Check the migration for dual writes',
  'Draft the runbook section',
  'Find allocations in the hot loop',
  'Audit tenant scoping',
  'Compare the two benchmark runs',
];

export const WORKFLOW_LENSES: string[] = [
  'Correctness lens',
  'Performance lens',
  'Test coverage lens',
  'Docs and naming lens',
];

/** Words used to pad tool results and injected text to a target length. */
const FILLER_WORDS: string[] = [
  'handler', 'queue', 'tenant', 'invoice', 'retry', 'budget', 'cursor', 'ledger', 'shard', 'index',
  'cache', 'token', 'window', 'replica', 'payload', 'schema', 'column', 'branch', 'commit', 'digest',
  'worker', 'timeout', 'backoff', 'jitter', 'signature', 'webhook', 'export', 'summary', 'metric',
  'threshold', 'quantile', 'baseline', 'fixture', 'snapshot', 'harness', 'builder', 'reader',
  'writer', 'router', 'adapter', 'boundary', 'lifecycle', 'contract', 'invariant', 'guard',
];

/**
 * Deterministic filler of about `chars` characters. `salt` makes two calls of the same length
 * differ. Two shapes, because the transcript view is a demo surface and word soup looks wrong in
 * the wrong place: `log` reads like a listing or command output, `prose` like written text.
 */
export function filler(chars: number, salt: number, mode: 'log' | 'prose' = 'log'): string {
  if (chars <= 0) return '';
  const parts: string[] = [];
  let length = 0;
  let n = (salt >>> 0) || 1;
  const nextWord = (): string => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    const word = FILLER_WORDS[n % FILLER_WORDS.length];
    return word ?? 'token';
  };
  while (length < chars) {
    const words: string[] = [];
    const count = 6 + (n % 9);
    for (let i = 0; i < count; i += 1) words.push(nextWord());
    if (mode === 'prose') {
      const sentence = `${words.join(' ')}.`;
      parts.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
      length += sentence.length + 1;
    } else {
      const line = `  ${words.join(' ')}`;
      parts.push(line);
      length += line.length + 1;
    }
  }
  return parts.join(mode === 'prose' ? ' ' : '\n').slice(0, Math.max(1, chars));
}

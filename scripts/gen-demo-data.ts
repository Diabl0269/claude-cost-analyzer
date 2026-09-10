/**
 * Generates the synthetic demo dataset (`core/demo/generate.ts`) on disk.
 *
 * Usage:
 *   node --import tsx/esm scripts/gen-demo-data.ts [--out <dir>] [--seed <n>] [--now <iso>] [--sessions <n>]
 *
 * `--out` is a demo *home*: the transcripts land in `<out>/projects`, which is what
 * `--claude-dir` should point at. Default `~/.claude-cost-analyzer/demo`. Nothing is ever written
 * under `~/.claude`, and the summary line reports counts only — never content.
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { DEMO_SEED, DEMO_SESSION_COUNT, generateDemoData } from '../core/demo/generate.js';

interface Args {
  out: string;
  seed: number;
  now: number;
  sessions: number;
}

const DEFAULT_OUT = path.join('~', '.claude-cost-analyzer', 'demo');

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith(`~${path.sep}`)) return path.join(homedir(), p.slice(2));
  return p;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: DEFAULT_OUT, seed: DEMO_SEED, now: Date.now(), sessions: DEMO_SESSION_COUNT };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--out' && value) {
      args.out = value;
      i += 1;
    } else if (flag === '--seed' && value) {
      const seed = Number(value);
      if (!Number.isFinite(seed)) throw new Error('--seed must be a number');
      args.seed = seed;
      i += 1;
    } else if (flag === '--now' && value) {
      const now = Date.parse(value);
      if (Number.isNaN(now)) throw new Error('--now must be an ISO timestamp');
      args.now = now;
      i += 1;
    } else if (flag === '--sessions' && value) {
      const sessions = Number(value);
      if (!Number.isInteger(sessions) || sessions < 5 || sessions > 400) {
        throw new Error('--sessions must be an integer between 5 and 400');
      }
      args.sessions = sessions;
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      console.log('usage: gen-demo-data [--out <dir>] [--seed <n>] [--now <iso>] [--sessions <n>]');
      process.exit(0);
    } else if (flag !== undefined && flag.startsWith('--')) {
      throw new Error(`unrecognized flag: ${flag}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(expandHome(args.out));
  const summary = await generateDemoData({
    outDir,
    seed: args.seed,
    now: args.now,
    sessions: args.sessions,
  });
  const mb = (summary.bytes / 1_048_576).toFixed(1);
  console.log(
    `demo data: ${summary.projects} projects, ${summary.sessions} sessions, ${summary.files} files, ` +
      `${summary.requests} requests, ${summary.agents} agents, ${summary.workflowRuns} workflow runs, ` +
      `${mb} MB, $${summary.totalUsd.toFixed(2)} at list prices, ${summary.firstDate}..${summary.lastDate} ` +
      `(seed ${args.seed}) → ${path.join(outDir, 'projects')}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'failed to generate demo data');
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Demo mode: generate the synthetic dataset (once, or again with `--fresh`) and serve it with the
 * built server, pointed at the demo home instead of `~/.claude`.
 *
 * Usage:
 *   node scripts/demo.mjs [--out <dir>] [--port 4142] [--fresh] [--no-open]
 *                         [--seed <n>] [--sessions <n>] [--now <iso>]
 *
 * Layout under `--out` (default `~/.claude-cost-analyzer/demo`):
 *   <out>/projects   the `~/.claude/projects`-shaped tree, passed as `--claude-dir`
 *   <out>/home       CCA_HOME for this dataset (index.sqlite + config.json), passed as `--home`
 *
 * Requires `npm run build` first: it runs `dist/server/cli.js`, exactly like `npm start`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(homedir(), '.claude-cost-analyzer', 'demo');

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith(`~${path.sep}`)) return path.join(homedir(), p.slice(2));
  return p;
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, port: '4142', fresh: false, open: true, gen: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--out' && value) { args.out = value; i += 1; }
    else if (flag === '--port' && value) { args.port = value; i += 1; }
    else if (flag === '--fresh') args.fresh = true;
    else if (flag === '--no-open') args.open = false;
    else if ((flag === '--seed' || flag === '--sessions' || flag === '--now') && value) {
      args.gen.push(flag, value);
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      console.log('usage: demo [--out <dir>] [--port 4142] [--fresh] [--no-open] [--seed n] [--sessions n] [--now iso]');
      process.exit(0);
    } else if (flag?.startsWith('--')) {
      console.error(`unrecognized flag: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

function run(command, argv, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd: repoRoot, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`))));
  });
}

async function generate(outDir, genArgs) {
  const built = path.join(repoRoot, 'dist', 'scripts', 'gen-demo-data.js');
  const argv = existsSync(built)
    ? [built, '--out', outDir, ...genArgs]
    : ['--import', 'tsx/esm', path.join(repoRoot, 'scripts', 'gen-demo-data.ts'), '--out', outDir, ...genArgs];
  await run(process.execPath, argv, 'gen-demo-data');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(expandHome(args.out));
  const projectsDir = path.join(outDir, 'projects');
  const homeDir = path.join(outDir, 'home');

  if (args.fresh) {
    // The dataset and its index are both rebuildable caches; a fresh run drops them together so
    // a new seed cannot leave the previous sessions behind in the tree or the DB.
    await rm(projectsDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
  if (!existsSync(projectsDir)) {
    await generate(outDir, args.gen);
  } else {
    console.log(`demo data: reusing ${projectsDir} (pass --fresh to regenerate)`);
  }

  const cli = path.join(repoRoot, 'dist', 'server', 'cli.js');
  if (!existsSync(cli)) {
    console.error('dist/server/cli.js is missing — run `npm run build` first');
    process.exit(1);
  }
  const serverArgs = [cli, '--claude-dir', projectsDir, '--home', homeDir, '--port', args.port];
  if (!args.open) serverArgs.push('--no-open');

  const server = spawn(process.execPath, serverArgs, { cwd: repoRoot, stdio: 'inherit' });
  const stop = (signal) => {
    if (!server.killed) server.kill(signal);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  server.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'demo mode failed');
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Dev orchestrator: runs the Hono server (Node's own `--watch`, restarting on file changes,
 * with tsx registered as an ESM loader) and the Vite dev server (proxying `/api` to the Hono
 * server) side by side, prefixing each line of output so it's clear which process said what.
 * Exits as soon as either child dies, and forwards Ctrl-C to both.
 *
 * Why `node --watch --import tsx/esm` rather than `tsx watch`: the `tsx` CLI opens a unix
 * domain socket to talk to its child, which sandboxed shells refuse (`EPERM`). `tsx/esm` is the
 * loader half only — same TypeScript support, no IPC — and it is the same loader
 * `server/indexing.ts` hands the indexing worker in dev.
 */
import { spawn } from 'node:child_process';

const RESET = '\x1b[0m';
const server = {
  name: 'server',
  color: '\x1b[36m', // cyan
  command: process.execPath,
  args: ['--watch', '--watch-preserve-output', '--import', 'tsx/esm', 'server/cli.ts', '--no-open'],
  env: { ...process.env, CCA_DEV: '1' },
};
const web = {
  name: 'web',
  color: '\x1b[35m', // magenta
  command: 'npx',
  args: ['vite'],
  env: process.env,
};

function prefixLines(label, color, chunk, stream) {
  const text = chunk.toString('utf8');
  const lines = text.split('\n');
  // last element is either '' (trailing newline) or a partial line; either way printing it as-is
  // keeps behavior simple for a dev-only tool.
  for (const line of lines) {
    if (line.length === 0) continue;
    stream.write(`${color}[${label}]${RESET} ${line}\n`);
  }
}

function startChild(spec) {
  const child = spawn(spec.command, spec.args, { env: spec.env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => prefixLines(spec.name, spec.color, chunk, process.stdout));
  child.stderr.on('data', (chunk) => prefixLines(spec.name, spec.color, chunk, process.stderr));
  return child;
}

const serverProc = startChild(server);
const webProc = startChild(web);
const children = [serverProc, webProc];

let exiting = false;
function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exitCode = code;
}

for (const child of children) {
  child.on('exit', (code) => {
    console.log(`[dev] ${child === serverProc ? 'server' : 'web'} exited (${code}); stopping the other process`);
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

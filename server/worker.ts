/**
 * Entry point run inside a `worker_threads` Worker (spawned by `server/indexing.ts`). Does the
 * actual (potentially slow) full/incremental index build so the main HTTP event loop stays
 * responsive. Talks to the parent purely over `postMessage`; never imports anything from
 * `server/` besides types, to keep the worker's dependency graph minimal.
 */
// Must be the first import (see server/warnings.ts): a worker thread has its own warning
// listeners, so the main thread's filter does not cover the `node:sqlite` warning emitted here.
// This is the one `server/` module the worker may import — it has no dependencies of its own.
import './warnings.js';
import { parentPort } from 'node:worker_threads';
import { runIndex, indexChangedFiles } from '../core/db/indexer.js';
import type { IndexProgress, PricingConfig } from '../core/types.js';
import type { IndexResult } from '../core/store.js';

export interface RunMessage {
  type: 'run';
  /** 'full': drop and rebuild everything. 'rescan': mtime/size diff across all roots (no
   * explicit path list needed). 'incremental': reparse only the sessions owning `paths`. */
  mode: 'full' | 'rescan' | 'incremental';
  roots: string[];
  dbPath: string;
  /** only used when mode === 'incremental' */
  paths?: string[];
  /**
   * The user's pricing table. Indexing needs it only for `charsPerToken`, which decides how many
   * tokens an attributed item is estimated at; passing the defaults instead would silently
   * mis-estimate attribution for anyone who edited a model's chars/token.
   */
  pricing: PricingConfig;
}

export type WorkerMessage =
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'done'; result: IndexResult }
  | { type: 'error'; message: string };

const MAX_ERROR_MESSAGE_LENGTH = 300;

function toErrorMessage(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown indexing error';
  return message.length > MAX_ERROR_MESSAGE_LENGTH ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : message;
}

async function handle(port: NonNullable<typeof parentPort>, msg: RunMessage): Promise<void> {
  const onProgress = (progress: IndexProgress): void => {
    const event: WorkerMessage = { type: 'progress', progress };
    port.postMessage(event);
  };
  try {
    const common = { roots: msg.roots, dbPath: msg.dbPath, pricing: msg.pricing, onProgress };
    const result =
      msg.mode === 'incremental'
        ? await indexChangedFiles(msg.paths ?? [], common)
        : await runIndex({ ...common, full: msg.mode === 'full' });
    const done: WorkerMessage = { type: 'done', result };
    port.postMessage(done);
  } catch (err) {
    const failed: WorkerMessage = { type: 'error', message: toErrorMessage(err) };
    port.postMessage(failed);
  }
}

if (!parentPort) {
  throw new Error('server/worker.ts must be run inside a worker_threads Worker');
}
const port = parentPort;
port.on('message', (msg: RunMessage) => {
  void handle(port, msg);
});

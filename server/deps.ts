/**
 * Shared dependency bag threaded through every route module, plus small helpers routes use
 * to turn the current config into a `QueryContext` for the Store.
 */
import type { Store, QueryContext } from '../core/store.js';
import type { ConfigStore } from './config.js';
import type { IndexManagerLike } from './indexing.js';
import type { SseHub } from './sse.js';

export interface AppDeps {
  store: Store;
  config: ConfigStore;
  index: IndexManagerLike;
  /** SSE hub backing `GET /api/events`; also the sink IndexManager broadcasts into. */
  sse: SseHub;
  port: number;
  dev: boolean;
  version: string;
  /** CCA_HOME (resolved, absolute); used by `PUT /api/settings` to keep a new `roots` entry from
   * pointing back at the app's own config/DB directory (see `rootsPolicy.ts`). */
  ccaHome: string;
  /**
   * The transcript roots actually being indexed. Not the same as `settings.roots`: `--claude-dir`
   * and `CCA_CLAUDE_DIR` override those, and `/api/status` must report what is really watched.
   */
  roots: string[];
  /** overrides the built web root static.ts serves; only used by tests (real callers omit it) */
  staticRoot?: string;
}

/**
 * Builds the Store's `QueryContext` (pricing + settings) from the current config snapshot.
 * `whatIf` is threaded through for the routes whose query object never reaches the Store
 * (session detail, transcript, agent tree, JSON export), so a simulation applies there too.
 */
export function queryContext(config: ConfigStore, whatIf?: string | undefined): QueryContext {
  const { pricing, settings } = config.get();
  return whatIf === undefined ? { pricing, settings } : { pricing, settings, whatIf };
}

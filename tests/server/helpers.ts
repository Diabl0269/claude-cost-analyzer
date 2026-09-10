/** Shared test scaffolding: builds `createApp` with a FakeStore + real ConfigStore (temp
 * CCA_HOME) + no-op IndexManager, and a helper to authenticate like the real web client does. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from '../../server/app.js';
import { ConfigStore } from '../../server/config.js';
import type { AppDeps } from '../../server/deps.js';
import type { IndexManagerLike } from '../../server/indexing.js';
import { createSseHub } from '../../server/sse.js';
import { FakeStore } from './fake-store.js';

export function fakeIndexManager(): IndexManagerLike {
  return {
    status: () => ({ indexing: false, lastIndexedAt: null }),
    requestFull: () => {},
    requestRescan: () => {},
    requestIncremental: () => {},
    dispose: () => Promise.resolve(),
  };
}

export interface TestApp {
  app: Hono;
  config: ConfigStore;
  store: FakeStore;
  home: string;
  port: number;
  cleanup(): void;
}

export function buildTestApp(
  opts: { port?: number; dev?: boolean; staticRoot?: string; roots?: string[] } = {},
): TestApp {
  const home = mkdtempSync(join(tmpdir(), 'cca-test-'));
  const config = ConfigStore.load(join(home, 'config.json'));
  const store = new FakeStore();
  const port = opts.port ?? 4141;
  const deps: AppDeps = {
    store,
    config,
    index: fakeIndexManager(),
    sse: createSseHub(),
    roots: opts.roots ?? ['/home/user/.claude/projects'],
    port,
    dev: opts.dev ?? false,
    version: 'test',
    staticRoot: opts.staticRoot,
    ccaHome: home,
  };
  return {
    app: createApp(deps),
    config,
    store,
    home,
    port,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/**
 * `Response.json()` is typed `unknown`, which is right for untrusted input and useless in a test
 * asserting on a shape it just produced. This is the JSON-parse boundary, so the `any` stops here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse boundary
export async function jsonBody<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Mimics the web client's boot sequence: POST /api/auth/session, then read the cookie. */
export async function authedCookieHeader(app: Hono, port: number): Promise<string> {
  const res = await app.request('/api/auth/session', {
    method: 'POST',
    headers: { host: `127.0.0.1:${port}` },
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /cca_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error(`auth/session did not set cca_session cookie (status ${res.status})`);
  return `cca_session=${match[1]}`;
}

/**
 * `createShutdown` (server/shutdown.ts): the SIGINT/SIGTERM shutdown sequence, exercised against
 * fakes only — no real `listen()`, no real worker thread, no real DB. Verifies the ordering that
 * fixed the shutdown hang: SSE clients are closed and the watcher/indexer are stopped *before*
 * the store, and the server's connections are force-closed rather than waited on forever.
 */
import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../../server/shutdown.js';

function makeDeps() {
  const calls: string[] = [];
  const watcher = { dispose: vi.fn(() => calls.push('watcher.dispose')) };
  const index = { dispose: vi.fn(async () => { calls.push('index.dispose'); }) };
  const sse = { closeAll: vi.fn(async () => { calls.push('sse.closeAll'); }) };
  const store = { close: vi.fn(() => calls.push('store.close')) };
  const server = {
    close: vi.fn((cb: (err?: Error) => void) => {
      calls.push('server.close');
      cb();
    }),
    closeIdleConnections: vi.fn(() => calls.push('server.closeIdleConnections')),
    closeAllConnections: vi.fn(() => calls.push('server.closeAllConnections')),
  };
  return { calls, watcher, index, sse, store, server };
}

describe('createShutdown', () => {
  it('closes SSE clients, terminates the worker, and closes the store, then resolves', async () => {
    const { calls, watcher, index, sse, store, server } = makeDeps();
    const close = createShutdown({ watcher, index, sse, store, server });

    await expect(close()).resolves.toBeUndefined();

    expect(watcher.dispose).toHaveBeenCalledTimes(1);
    expect(index.dispose).toHaveBeenCalledTimes(1);
    expect(sse.closeAll).toHaveBeenCalledTimes(1);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('runs watcher/indexer/SSE teardown before closing the store (no store-closed race)', async () => {
    const { calls, watcher, index, sse, store, server } = makeDeps();
    const close = createShutdown({ watcher, index, sse, store, server });

    await close();

    const storeIndex = calls.indexOf('store.close');
    expect(storeIndex).toBeGreaterThan(calls.indexOf('watcher.dispose'));
    expect(storeIndex).toBeGreaterThan(calls.indexOf('index.dispose'));
    expect(storeIndex).toBeGreaterThan(calls.indexOf('sse.closeAll'));
    // The store closes only after the server has actually finished closing its connections.
    expect(storeIndex).toBeGreaterThan(calls.indexOf('server.close'));
  });

  it('force-closes idle/remaining server connections instead of only waiting on them', async () => {
    const { watcher, index, sse, store, server } = makeDeps();
    const close = createShutdown({ watcher, index, sse, store, server });

    await close();

    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  });

  it('tolerates a server without closeIdleConnections/closeAllConnections (Http2Server half of the union)', async () => {
    const { watcher, index, sse, store } = makeDeps();
    const server = { close: vi.fn((cb: (err?: Error) => void) => cb()) };
    const close = createShutdown({ watcher, index, sse, store, server });

    await expect(close()).resolves.toBeUndefined();
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('propagates a server.close() error instead of closing the store on a broken shutdown', async () => {
    const { watcher, index, sse, store } = makeDeps();
    const boom = new Error('boom');
    const server = { close: vi.fn((cb: (err?: Error) => void) => cb(boom)) };
    const close = createShutdown({ watcher, index, sse, store, server });

    await expect(close()).rejects.toThrow('boom');
    expect(store.close).not.toHaveBeenCalled();
  });
});

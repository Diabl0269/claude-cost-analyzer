/**
 * `createSseHub` resource cleanup (SPEC §7: SSE must not buffer forever, a disconnected client
 * must free its resources). Cancelling the response body's `ReadableStream` is what a real
 * disconnect looks like at this layer: `@hono/node-server` cancels the stream when the
 * underlying socket closes, which is what actually fires `StreamingApi`'s `onAbort` subscribers
 * (see `node_modules/hono/dist/utils/stream.js`) — aborting the *request*'s `AbortSignal` does
 * not, since Hono only wires that up for old Bun. Cancelling the body reader is the correct way
 * to simulate a client going away in an in-process `app.request()` test.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createSseHub } from '../../server/sse.js';

describe('SSE hub', () => {
  it('registers a client while the stream is open', async () => {
    const hub = createSseHub();
    const app = new Hono();
    app.get('/events', (c) => hub.handler(c));

    const res = await app.request('/events');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hub.clientCount()).toBe(1);

    await res.body?.cancel();
  });

  it('frees every client once its response body is cancelled (client disconnect)', async () => {
    const hub = createSseHub();
    const app = new Hono();
    app.get('/events', (c) => hub.handler(c));

    const CLIENT_COUNT = 50;
    const readers = await Promise.all(
      Array.from({ length: CLIENT_COUNT }, async () => {
        const res = await app.request('/events');
        return res.body!.getReader();
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hub.clientCount()).toBe(CLIENT_COUNT);

    // A broadcast while all 50 are connected must not throw even though nothing is draining
    // the streams yet (each client's write is fire-and-forget with its own .catch()).
    expect(() => hub.broadcast({ type: 'indexed', at: new Date().toISOString() })).not.toThrow();

    await Promise.all(readers.map((r) => r.cancel()));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(hub.clientCount()).toBe(0);
  });

  it('a broadcast after every client disconnected is a no-op, not an error', () => {
    const hub = createSseHub();
    expect(() => hub.broadcast({ type: 'indexed', at: new Date().toISOString() })).not.toThrow();
    expect(hub.clientCount()).toBe(0);
  });

  it('closeAll ends every open stream (writes a bye frame, closes the writer) and clears clients', async () => {
    const hub = createSseHub();
    const app = new Hono();
    app.get('/events', (c) => hub.handler(c));

    const CLIENT_COUNT = 5;
    const responses = await Promise.all(Array.from({ length: CLIENT_COUNT }, () => app.request('/events')));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hub.clientCount()).toBe(CLIENT_COUNT);

    await hub.closeAll();
    expect(hub.clientCount()).toBe(0);

    // Each stream ended itself (not a client-driven cancel): the body should be fully readable
    // to completion, ending in a `bye` frame, rather than erroring out.
    const bodies = await Promise.all(
      responses.map(async (res) => {
        const text = await res.text();
        return text;
      }),
    );
    for (const text of bodies) {
      expect(text).toContain('event: bye');
    }
  });

  it('closeAll on a hub with no clients resolves without throwing', async () => {
    const hub = createSseHub();
    await expect(hub.closeAll()).resolves.toBeUndefined();
  });
});

/**
 * Two contract details worth locking down:
 *  - the routes whose query object never reaches the Store (session detail, transcript, agent
 *    tree, JSON export) must still forward `?whatIf=` through the `QueryContext`;
 *  - `CCA_DEV_ORIGINS` widens the Host/Origin allow-list, but only in dev and only to loopback.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { authedCookieHeader, buildTestApp, jsonBody, type TestApp } from './helpers.js';
import { FAKE_SESSION_ID } from './fake-store.js';

const WHAT_IF = 'opus-5>sonnet-5';

describe('whatIf threading', () => {
  let ctx: TestApp;

  afterEach(() => {
    ctx?.cleanup();
  });

  async function get(path: string): Promise<Response> {
    ctx = ctx ?? buildTestApp();
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    return ctx.app.request(path, { headers: { host: `127.0.0.1:${ctx.port}`, cookie } });
  }

  const routes = [
    `/api/sessions/${FAKE_SESSION_ID}`,
    `/api/sessions/${FAKE_SESSION_ID}/transcript`,
    `/api/sessions/${FAKE_SESSION_ID}/agents`,
    `/api/export/sessions/${FAKE_SESSION_ID}.json`,
  ];

  for (const route of routes) {
    it(`forwards ?whatIf= into the query context on ${route}`, async () => {
      ctx = buildTestApp();
      const res = await get(`${route}?whatIf=${encodeURIComponent(WHAT_IF)}`);
      expect(res.status).toBe(200);
      expect(ctx.store.lastSessionContext?.whatIf).toBe(WHAT_IF);
    });
  }

  it('leaves whatIf unset when the query omits it', async () => {
    ctx = buildTestApp();
    const res = await get(`/api/sessions/${FAKE_SESSION_ID}`);
    expect(res.status).toBe(200);
    expect(ctx.store.lastSessionContext?.whatIf).toBeUndefined();
  });

  it('rejects an over-long whatIf without echoing it', async () => {
    ctx = buildTestApp();
    const res = await get(`/api/sessions/${FAKE_SESSION_ID}?whatIf=${'a'.repeat(5000)}`);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('aaaa');
  });
});

describe('CCA_DEV_ORIGINS', () => {
  let ctx: TestApp;
  const original = process.env.CCA_DEV_ORIGINS;
  const originalVitePort = process.env.CCA_VITE_PORT;

  afterEach(() => {
    ctx?.cleanup();
    if (original === undefined) delete process.env.CCA_DEV_ORIGINS;
    else process.env.CCA_DEV_ORIGINS = original;
    if (originalVitePort === undefined) delete process.env.CCA_VITE_PORT;
    else process.env.CCA_VITE_PORT = originalVitePort;
  });

  it('accepts an extra loopback dev origin as Host and as Origin', async () => {
    process.env.CCA_DEV_ORIGINS = 'http://127.0.0.1:5174, http://localhost:5174';
    ctx = buildTestApp({ dev: true });
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const byHost = await ctx.app.request('/api/status', { headers: { host: '127.0.0.1:5174', cookie } });
    expect(byHost.status).toBe(200);
    const byOrigin = await ctx.app.request('/api/status', {
      headers: { host: `127.0.0.1:${ctx.port}`, origin: 'http://localhost:5174', cookie },
    });
    expect(byOrigin.status).toBe(200);
  });

  it('accepts the Vite dev origin from CCA_VITE_PORT, without CCA_DEV_ORIGINS', async () => {
    // `npm run dev` proxies /api through Vite, so a POST from that UI carries the Vite origin.
    delete process.env.CCA_DEV_ORIGINS;
    process.env.CCA_VITE_PORT = '5191';
    ctx = buildTestApp({ dev: true });
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const res = await ctx.app.request('/api/status', {
      headers: { host: `127.0.0.1:${ctx.port}`, origin: 'http://127.0.0.1:5191', cookie },
    });
    expect(res.status).toBe(200);
  });

  it('ignores the Vite dev origin outside dev mode', async () => {
    delete process.env.CCA_DEV_ORIGINS;
    process.env.CCA_VITE_PORT = '5191';
    ctx = buildTestApp({ dev: false });
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const res = await ctx.app.request('/api/status', {
      headers: { host: `127.0.0.1:${ctx.port}`, origin: 'http://127.0.0.1:5191', cookie },
    });
    expect(res.status).toBe(403);
  });

  it('ignores it outside dev mode', async () => {
    process.env.CCA_DEV_ORIGINS = 'http://127.0.0.1:5174';
    ctx = buildTestApp({ dev: false });
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const res = await ctx.app.request('/api/status', { headers: { host: '127.0.0.1:5174', cookie } });
    expect(res.status).toBe(403);
  });

  it('drops non-loopback and port-less entries', async () => {
    process.env.CCA_DEV_ORIGINS = 'http://evil.example.com:5174,http://127.0.0.1,not-a-url';
    ctx = buildTestApp({ dev: true });
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    for (const host of ['evil.example.com:5174', '127.0.0.1', 'not-a-url']) {
      const res = await ctx.app.request('/api/status', { headers: { host, cookie } });
      expect(res.status).toBe(403);
    }
  });
});

describe('GET /api/status roots', () => {
  let ctx: TestApp;

  afterEach(() => {
    ctx?.cleanup();
  });

  it('reports the resolved roots, not the configured ones', async () => {
    ctx = buildTestApp({ roots: ['/tmp/fixture-root'] });
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const res = await ctx.app.request('/api/status', { headers: { host: `127.0.0.1:${ctx.port}`, cookie } });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.roots).toEqual(['/tmp/fixture-root']);
    expect(ctx.config.get().settings.roots).not.toEqual(['/tmp/fixture-root']);
  });
});

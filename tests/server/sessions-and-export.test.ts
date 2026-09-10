import { afterEach, describe, expect, it } from 'vitest';
import { authedCookieHeader, buildTestApp, jsonBody, type TestApp } from './helpers.js';

describe('sessions + export', () => {
  let ctx: TestApp;
  let cookie: string;

  afterEach(() => {
    ctx?.cleanup();
  });

  async function setup(): Promise<void> {
    ctx = buildTestApp();
    cookie = await authedCookieHeader(ctx.app, ctx.port);
  }

  it('404s an unknown session id with the standard error envelope', async () => {
    await setup();
    const res = await ctx.app.request('/api/sessions/does-not-exist', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('200s a known session id', async () => {
    await setup();
    const res = await ctx.app.request('/api/sessions/sess-1', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).summary.id).toBe('sess-1');
  });

  it('CSV export has the right content type and attachment disposition', async () => {
    await setup();
    const res = await ctx.app.request('/api/export/sessions.csv', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('sessions.csv');
    const text = await res.text();
    expect(text.startsWith('id,title,cost')).toBe(true);
  });

  it('JSON session export sets a filename and 404s for an unknown id', async () => {
    await setup();
    const ok = await ctx.app.request('/api/export/sessions/sess-1.json', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toContain('sess-1.json');

    const missing = await ctx.app.request('/api/export/sessions/nope.json', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(missing.status).toBe(404);
  });
});

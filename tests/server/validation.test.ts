import { afterEach, describe, expect, it } from 'vitest';
import { authedCookieHeader, buildTestApp, jsonBody, type TestApp } from './helpers.js';

describe('validation', () => {
  let ctx: TestApp;
  let cookie: string;

  afterEach(() => {
    ctx?.cleanup();
  });

  async function setup(): Promise<void> {
    ctx = buildTestApp();
    cookie = await authedCookieHeader(ctx.app, ctx.port);
  }

  it('400s on a bad date in a range query, without echoing the raw input', async () => {
    await setup();
    const badDate = '<script>not-a-date</script>';
    const res = await ctx.app.request(`/api/analytics/overview?from=${encodeURIComponent(badDate)}`, {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error.code).toBe('bad_request');
    expect(JSON.stringify(body)).not.toContain(badDate);
  });

  it('400s on an out-of-range limit', async () => {
    await setup();
    const res = await ctx.app.request('/api/sessions?limit=99999', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(400);
  });

  it('400s on a malformed pricing PUT body without echoing it', async () => {
    await setup();
    const secret = 'not-a-real-secret-just-a-marker-9f3a';
    const res = await ctx.app.request('/api/pricing', {
      method: 'PUT',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ nonsense: secret }),
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain(secret);
  });

  it('400s on invalid JSON body', async () => {
    await setup();
    const res = await ctx.app.request('/api/pricing', {
      method: 'PUT',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie, 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});

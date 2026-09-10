import { afterEach, describe, expect, it } from 'vitest';
import { authedCookieHeader, buildTestApp, jsonBody, type TestApp } from './helpers.js';

describe('pricing + settings + pins (real ConfigStore, temp CCA_HOME)', () => {
  let ctx: TestApp;
  let cookie: string;

  afterEach(() => {
    ctx?.cleanup();
  });

  async function setup(): Promise<void> {
    ctx = buildTestApp();
    cookie = await authedCookieHeader(ctx.app, ctx.port);
  }

  it('round-trips a pricing PUT and persists it to config.json', async () => {
    await setup();
    const current = await jsonBody(
      await ctx.app.request('/api/pricing', { headers: { host: `127.0.0.1:${ctx.port}`, cookie } }),
    );

    const updated = { ...current, webSearchPer1000: 12.5 };
    const putRes = await ctx.app.request('/api/pricing', {
      method: 'PUT',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(updated),
    });
    expect(putRes.status).toBe(200);
    const putBody = await jsonBody(putRes);
    expect(putBody.webSearchPer1000).toBe(12.5);

    const getRes = await ctx.app.request('/api/pricing', { headers: { host: `127.0.0.1:${ctx.port}`, cookie } });
    const getBody = await jsonBody(getRes);
    expect(getBody.webSearchPer1000).toBe(12.5);
  });

  it('resets pricing back to defaults', async () => {
    await setup();
    await ctx.app.request('/api/pricing', {
      method: 'PUT',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ...ctx.config.get().pricing, webSearchPer1000: 999 }),
    });
    const resetRes = await ctx.app.request('/api/pricing/reset', {
      method: 'POST',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(resetRes.status).toBe(200);
    const body = await jsonBody(resetRes);
    expect(body.webSearchPer1000).toBe(10);
  });

  it('round-trips a settings PUT', async () => {
    await setup();
    const current = await jsonBody(
      await ctx.app.request('/api/settings', { headers: { host: `127.0.0.1:${ctx.port}`, cookie } }),
    );
    const updated = { ...current, monthlyBudgetUsd: 250 };

    const putRes = await ctx.app.request('/api/settings', {
      method: 'PUT',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(updated),
    });
    expect(putRes.status).toBe(200);
    expect((await jsonBody(putRes)).monthlyBudgetUsd).toBe(250);
    expect(ctx.config.get().settings.monthlyBudgetUsd).toBe(250);
  });

  it('toggles a session pin on and off', async () => {
    await setup();
    const first = await ctx.app.request('/api/sessions/sess-1/pin', {
      method: 'POST',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(first.status).toBe(200);
    expect((await jsonBody(first)).pinned).toBe(true);
    expect(ctx.config.get().settings.pinnedSessionIds).toContain('sess-1');

    const second = await ctx.app.request('/api/sessions/sess-1/pin', {
      method: 'POST',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect((await jsonBody(second)).pinned).toBe(false);
    expect(ctx.config.get().settings.pinnedSessionIds).not.toContain('sess-1');
  });

  it('404s pinning an unknown session', async () => {
    await setup();
    const res = await ctx.app.request('/api/sessions/does-not-exist/pin', {
      method: 'POST',
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(404);
  });
});

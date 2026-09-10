import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authedCookieHeader, buildTestApp, jsonBody, type TestApp } from './helpers.js';

describe('SPA fallback vs /api 404', () => {
  let ctx: TestApp;
  let webRoot: string;

  afterEach(() => {
    ctx?.cleanup();
    if (webRoot) rmSync(webRoot, { recursive: true, force: true });
  });

  it('an unknown /api/* route returns the JSON error envelope', async () => {
    ctx = buildTestApp();
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const res = await ctx.app.request('/api/does-not-exist', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await jsonBody(res);
    expect(body.error.code).toBe('not_found');
  });

  it('an unknown non-api route falls back to the built SPA shell, not the JSON envelope', async () => {
    webRoot = mkdtempSync(join(tmpdir(), 'cca-web-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app shell</title>');
    ctx = buildTestApp({ staticRoot: webRoot });
    const res = await ctx.app.request('/some/client/route', { headers: { host: `127.0.0.1:${ctx.port}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('app shell');
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { staticMiddleware } from '../../server/static.js';

describe('static middleware', () => {
  let webRoot: string;

  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'cca-web-'));
    mkdirSync(join(webRoot, 'assets'), { recursive: true });
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app shell</title>');
    writeFileSync(join(webRoot, 'assets', 'app.abc123.js'), 'console.log("hi")');
    mkdirSync(join(webRoot, 'secret'), { recursive: true });
    writeFileSync(join(webRoot, '..', 'outside.txt'), 'should never be served', { flag: 'w' });
  });

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true });
    rmSync(join(webRoot, '..', 'outside.txt'), { force: true });
  });

  function buildApp(): Hono {
    const app = new Hono();
    app.use('*', staticMiddleware({ webRoot }));
    return app;
  }

  it('serves a real asset with immutable caching under /assets', async () => {
    const app = buildApp();
    const res = await app.request('/assets/app.abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('falls back to index.html for an unknown client-side route', async () => {
    const app = buildApp();
    const res = await app.request('/sessions/abc123');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('app shell');
  });

  it('blocks path traversal outside the web root', async () => {
    const app = buildApp();
    const res = await app.request('/../outside.txt');
    // the traversal segment is normalized away, then falls back to the SPA shell rather than
    // ever reading outside webRoot
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('app shell');
  });

  it('blocks percent-encoded traversal segments (%2e%2e)', async () => {
    const app = buildApp();
    const res = await app.request('/assets/%2e%2e/%2e%2e/outside.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('app shell');
  });

  it('blocks a doubled leading slash from escaping the web root', async () => {
    const app = buildApp();
    const res = await app.request('//../../outside.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('app shell');
  });

  it('shows the dev notice on any route when dist/web has not been built', async () => {
    const missingRoot = join(webRoot, 'does-not-exist');
    const app = new Hono();
    app.use('*', staticMiddleware({ webRoot: missingRoot }));
    // `/` and a deep client-side link both land on the notice: reloading /sessions after
    // `npm start` without a build used to return a bare "not found".
    for (const path of ['/', '/index.html', '/sessions', '/sessions/abc123']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain('npm run build');
    }
  });

  it('still 404s a missing asset when dist/web has not been built', async () => {
    const missingRoot = join(webRoot, 'does-not-exist');
    const app = new Hono();
    app.use('*', staticMiddleware({ webRoot: missingRoot }));
    const res = await app.request('/assets/app.abc123.js');
    expect(res.status).toBe(404);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { authedCookieHeader, buildTestApp, jsonBody, type TestApp } from './helpers.js';

describe('auth', () => {
  let ctx: TestApp;

  afterEach(() => {
    ctx?.cleanup();
  });

  it('rejects /api/* with no cookie as 401', async () => {
    ctx = buildTestApp();
    const res = await ctx.app.request('/api/status', { headers: { host: `127.0.0.1:${ctx.port}` } });
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body.error.code).toBe('unauthenticated');
  });

  it('rejects a wrong Host as 403', async () => {
    ctx = buildTestApp();
    const res = await ctx.app.request('/api/status', { headers: { host: 'evil.example.com' } });
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('rejects a cross-site Sec-Fetch-Site as 403', async () => {
    ctx = buildTestApp();
    const res = await ctx.app.request('/api/status', {
      headers: { host: `127.0.0.1:${ctx.port}`, 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(403);
  });

  it('allows the happy path: issue cookie, then call an authenticated route', async () => {
    ctx = buildTestApp();
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const res = await ctx.app.request('/api/status', {
      headers: { host: `127.0.0.1:${ctx.port}`, cookie },
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.version).toBe('test');
  });

  it('CCA_ALLOW_UNAUTH_STATUS=1 exempts only GET /api/status', async () => {
    ctx = buildTestApp();
    const originalEnv = process.env.CCA_ALLOW_UNAUTH_STATUS;
    process.env.CCA_ALLOW_UNAUTH_STATUS = '1';
    try {
      const status = await ctx.app.request('/api/status', { headers: { host: `127.0.0.1:${ctx.port}` } });
      expect(status.status).toBe(200);

      const projects = await ctx.app.request('/api/projects', { headers: { host: `127.0.0.1:${ctx.port}` } });
      expect(projects.status).toBe(401);
    } finally {
      if (originalEnv === undefined) delete process.env.CCA_ALLOW_UNAUTH_STATUS;
      else process.env.CCA_ALLOW_UNAUTH_STATUS = originalEnv;
    }
  });

  it('sets the session cookie HttpOnly, SameSite=Strict, Path=/', async () => {
    ctx = buildTestApp();
    const res = await ctx.app.request('/api/auth/session', {
      method: 'POST',
      headers: { host: `127.0.0.1:${ctx.port}` },
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    // never Secure: this is plain http://127.0.0.1, and `Secure` would silently drop the cookie
    expect(setCookie).not.toContain('Secure');
  });

  it('rejects an Origin mismatch on POST /api/auth/session as 403', async () => {
    ctx = buildTestApp();
    const res = await ctx.app.request('/api/auth/session', {
      method: 'POST',
      headers: { host: `127.0.0.1:${ctx.port}`, origin: 'http://evil.example.com' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('a session cookie minted by one server instance is rejected by another (per-process token)', async () => {
    const first = buildTestApp({ port: 4141 });
    const second = buildTestApp({ port: 4141 });
    try {
      const cookie = await authedCookieHeader(first.app, first.port);
      const res = await second.app.request('/api/status', {
        headers: { host: '127.0.0.1:4141', cookie },
      });
      expect(res.status).toBe(401);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  it.each([
    ['127.0.0.1:4141.evil.com', 'appended-domain suffix'],
    ['localhost.', 'trailing dot'],
    ['[::1]:4141', 'IPv6 loopback literal'],
    ['127.0.0.1', 'missing port'],
    ['LOCALHOST:4141', 'wrong case'],
    ['127.0.0.1:04141', 'zero-padded port'],
    ['0177.0.0.1:4141', 'octal-looking IPv4'],
    ['2130706433:4141', 'decimal IPv4'],
    ['127.1:4141', 'short-form IPv4'],
    ['::ffff:127.0.0.1:4141', 'IPv4-mapped IPv6, no brackets'],
  ])('rejects Host %j (%s) as 403', async (host) => {
    ctx = buildTestApp({ port: 4141 });
    const res = await ctx.app.request('/api/status', { headers: { host } });
    expect(res.status).toBe(403);
  });

  it('allows the Vite dev origin when dev:true, rejects it otherwise', async () => {
    const devCtx = buildTestApp({ dev: true, port: 4141 });
    try {
      const res = await devCtx.app.request('/api/status', {
        headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' },
      });
      expect(res.status).toBe(401); // Host is allowed; still needs the cookie
    } finally {
      devCtx.cleanup();
    }

    const prodCtx = buildTestApp({ dev: false, port: 4141 });
    try {
      const res = await prodCtx.app.request('/api/status', { headers: { host: '127.0.0.1:5173' } });
      expect(res.status).toBe(403);
    } finally {
      prodCtx.cleanup();
    }
  });
});

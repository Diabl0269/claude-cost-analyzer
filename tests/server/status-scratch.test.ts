/**
 * `GET /api/status` reports how many indexed sessions the `hideScratchProjects` setting is
 * hiding, so the UI can print "N indexed · M scratch hidden" instead of leaving the gap
 * between the index count and the visible lists unexplained.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { authedCookieHeader, buildTestApp, jsonBody, type TestApp } from './helpers.js';

describe('GET /api/status scratchSessions', () => {
  let ctx: TestApp;

  afterEach(() => {
    ctx?.cleanup();
  });

  async function status(): Promise<{ counts: { sessions: number }; scratchSessions?: number }> {
    const cookie = await authedCookieHeader(ctx.app, ctx.port);
    const res = await ctx.app.request('/api/status', { headers: { host: `127.0.0.1:${ctx.port}`, cookie } });
    expect(res.status).toBe(200);
    return jsonBody(res);
  }

  it('counts scratch sessions, including worktrees under a scratch project', async () => {
    ctx = buildTestApp();
    const settings = ctx.config.get().settings;
    ctx.config.updateSettings({ ...settings, hideScratchProjects: true });

    const body = await status();
    // The fake store reports 5 scratch sessions from Store.status() (all-time, independent of the range).
    expect(body.scratchSessions).toBe(5);
    // counts.sessions is a raw row count and is unaffected by the setting.
    expect(body.counts.sessions).toBe(1);
  });

  it('omits the field when nothing is being hidden', async () => {
    ctx = buildTestApp();
    const settings = ctx.config.get().settings;
    ctx.config.updateSettings({ ...settings, hideScratchProjects: false });

    const body = await status();
    expect(body.scratchSessions).toBeUndefined();
  });
});

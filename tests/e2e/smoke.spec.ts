/**
 * Smoke suite: the server indexes the synthetic fixture root, and every page in SPEC §8.4 (plus
 * the design gallery) renders a heading without a console error or a failed request.
 *
 * Page authors: add assertions about your own page's content to the per-route blocks below, and
 * add new routes to `ROUTES` in `helpers.ts` so the a11y suite picks them up too.
 */
import { expect, test } from '@playwright/test';
import {
  ROUTES,
  assertNoProblems,
  firstSessionId,
  login,
  openRoute,
  waitForIndexed,
  watchForProblems,
} from './helpers.js';

test.describe('api', () => {
  test('indexes the fixture root and reports a consistent status', async ({ request }) => {
    const status = await waitForIndexed(request);
    expect(status.indexing).toBe(false);
    expect(status.counts.sessions).toBeGreaterThan(0);
    expect(status.counts.requests).toBeGreaterThan(0);

    await login(request);
    const overview = await request.get('/api/analytics/overview?from=2000-01-01&to=2100-01-01');
    expect(overview.status()).toBe(200);
    const sessions = await request.get('/api/sessions?from=2000-01-01&to=2100-01-01&limit=100');
    expect(sessions.status()).toBe(200);

    const overviewBody = (await overview.json()) as { totals: { cost: { total: number } } };
    const sessionsBody = (await sessions.json()) as { totalCost: number; total: number };
    expect(overviewBody.totals.cost.total).toBeCloseTo(sessionsBody.totalCost, 6);
  });

  test('requires the session cookie', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL: baseURL as string });
    const response = await anonymous.get('/api/sessions');
    expect(response.status()).toBe(401);
    await anonymous.dispose();
  });
});

test.describe('pages render', () => {
  test.beforeEach(async ({ request }) => {
    await waitForIndexed(request);
  });

  for (const route of ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      const problems = watchForProblems(page);
      await openRoute(page, route.path);
      await expect(page.locator('h1').first()).not.toBeEmpty();
      await expect(page.locator('main')).toBeVisible();
      assertNoProblems(problems, route.path);
    });
  }

  test('session detail (/sessions/:id)', async ({ page, request }) => {
    const id = await firstSessionId(request);
    const problems = watchForProblems(page);
    await openRoute(page, `/sessions/${id}`);
    await expect(page.locator('h1').first()).not.toBeEmpty();
    assertNoProblems(problems, `/sessions/${id}`);
  });
});

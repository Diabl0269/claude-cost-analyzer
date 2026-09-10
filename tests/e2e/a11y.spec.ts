/**
 * Accessibility suite (SPEC §9): axe must find no serious or critical violation on any page,
 * in either theme.
 *
 * The scan itself is `expectNoAxeViolations` from `./helpers.js` — the same one the page suites
 * use for their own states — so there is exactly one definition of "blocking" and one place that
 * waits for finite animations to settle before judging pixels.
 */
import { test } from '@playwright/test';
import { ROUTES, expectNoAxeViolations, firstSessionId, openRoute, waitForIndexed } from './helpers.js';

test.describe('axe', () => {
  test.beforeEach(async ({ request }) => {
    await waitForIndexed(request);
  });

  for (const route of ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      await openRoute(page, route.path);
      await expectNoAxeViolations(page, route.path);
    });
  }

  test('session detail (/sessions/:id)', async ({ page, request }) => {
    const id = await firstSessionId(request);
    await openRoute(page, `/sessions/${id}`);
    await expectNoAxeViolations(page, `/sessions/${id}`);
  });

  for (const scheme of ['dark', 'light'] as const) {
    test(`every page in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const route of ROUTES) {
        await openRoute(page, route.path);
        await expectNoAxeViolations(page, `${route.path} (${scheme})`);
      }
    });
  }
});

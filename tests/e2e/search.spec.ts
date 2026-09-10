/**
 * Search (SPEC section 8.4). The fixture prompts are invented; "rename" appears in exactly
 * one session (A1) and "triage" only in the title of A2.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Result } from 'axe-core';
import { assertNoProblems, openRoute, waitForIndexed, watchForProblems } from './helpers.js';

const ALL_TIME = 'from=2000-01-01&to=2100-01-01';
const BLOCKING = new Set(['serious', 'critical']);

async function scan(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking: Result[] = results.violations.filter((violation: Result) => BLOCKING.has(violation.impact ?? ''));
  expect(
    blocking.map((violation) => `${violation.id} (${violation.impact}) x ${violation.nodes.length}`),
    `serious/critical axe violations on ${where}`,
  ).toEqual([]);
}

test.describe('search', () => {
  test.beforeEach(async ({ request }) => {
    await waitForIndexed(request);
  });

  test('finds a fixture prompt, highlights it, and opens the transcript there', async ({ page }) => {
    const problems = watchForProblems(page);
    await openRoute(page, `/search?${ALL_TIME}&q=rename`);

    await expect(page.getByText(/sessions? matched in/)).toBeVisible();
    const group = page.locator('article').filter({ hasText: 'Rename the utils helper' });
    await expect(group).toHaveCount(1);
    // The snippet is rendered as elements, with <mark> around the match.
    await expect(group.locator('mark').first()).toHaveText(/rename/i);

    await group.locator('[data-hit]').first().click();
    await expect(page).toHaveURL(/\/sessions\/a1111111-1111-4111-8111-111111111111\/transcript\?seq=\d+/);
    await expect(page.getByText(/Jumped to line/)).toBeVisible();
    assertNoProblems(problems, '/search');
  });

  test('the title scope matches session titles only', async ({ page }) => {
    await openRoute(page, `/search?${ALL_TIME}&q=triage&scope=titles`);
    const groups = page.locator('article');
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toContainText('Build failure triage');
    await expect(groups.first()).toContainText('title match');
  });

  test('kind filters and the empty state', async ({ page }) => {
    await openRoute(page, `/search?${ALL_TIME}&q=helper`);
    await expect(page.locator('article').first()).toBeVisible();

    await page.getByRole('button', { name: 'Prompts', exact: true }).click();
    await expect(page).toHaveURL(/kinds=prompt/);
    // Only prompt lines survive the filter. Asserted with a retrying matcher rather than a
    // one-shot `innerText`: the URL changes before the refetch resolves, so reading the DOM
    // immediately after it still sees the unfiltered list.
    const kinds = page.locator('article [data-hit] > span').first();
    await expect(kinds).toHaveText(/prompt/);

    await openRoute(page, `/search?${ALL_TIME}&q=zzzznothingmatchesthis`);
    await expect(page.getByText(/Nothing matched/)).toBeVisible();
  });

  test('axe reports nothing serious', async ({ page }) => {
    await openRoute(page, `/search?${ALL_TIME}&q=helper`);
    await scan(page, '/search');
    await page.emulateMedia({ colorScheme: 'dark' });
    await openRoute(page, `/search?${ALL_TIME}&q=helper`);
    await scan(page, '/search (dark)');
  });
});

/**
 * Shell behaviour that no page suite owns: the global shortcuts, the `/` hand-off on the search
 * page, the project tree's session counts, the scratch-hidden note, and the transcript's turn
 * jumps. Asserted against the synthetic fixture root (see tests/fixtures/README.md): four
 * visible sessions plus one in a scratch project, which the default settings hide.
 */
import { expect, test } from '@playwright/test';
import { assertNoProblems, openRoute, waitForIndexed, watchForProblems } from './helpers.js';

const ALL_TIME = 'from=2000-01-01&to=2100-01-01';
/** The only fixture session with more than one turn — the one the `[` / `]` jumps need. */
const A1 = 'a1111111-1111-4111-8111-111111111111';

/** What the browser considers focused, named the way an assistive technology would read it. */
async function focused(page: import('@playwright/test').Page): Promise<{ name: string; inMain: boolean; turn: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { name: '', inMain: false, turn: false };
    return {
      name: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 60),
      inMain: !!el.closest('#main'),
      turn: el.hasAttribute('data-turn'),
    };
  });
}

test.describe('shell', () => {
  test.beforeEach(async ({ request }) => {
    await waitForIndexed(request);
  });

  test('"/" focuses the top bar everywhere but the search page, where it focuses the page field', async ({ page }) => {
    await openRoute(page, '/');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('/');
    expect((await focused(page)).inMain, 'on / the top-bar field takes it').toBe(false);

    await openRoute(page, `/search?${ALL_TIME}`);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('/');
    const onSearch = await focused(page);
    expect(onSearch.inMain, 'on /search the page field takes it').toBe(true);
    await expect(page.locator('[data-page-search]')).toBeFocused();
  });

  test('the rail has Compare, reachable with "g c"', async ({ page }) => {
    await openRoute(page, '/');
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Compare' })).toBeVisible();

    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await page.waitForURL((url) => url.pathname === '/compare', { timeout: 5_000 });
  });

  test('project rows carry a session count as well as a cost', async ({ page }) => {
    await openRoute(page, `/sessions?${ALL_TIME}`);
    const alpha = page.getByRole('tree', { name: 'Projects' }).getByRole('treeitem', { name: /alpha/ }).first();
    // The count is spelled out for a screen reader and shown as bare digits next to the money.
    await expect(alpha).toHaveAccessibleName(/sessions? with requests in range/);
    await expect(alpha).toHaveAccessibleName(/\$/);
  });

  test('the sessions footer says how many sessions the scratch filter is hiding', async ({ page }) => {
    const problems = watchForProblems(page);
    await openRoute(page, `/sessions?${ALL_TIME}`);
    const link = page.locator('tfoot').getByRole('link', { name: /scratch hidden/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/settings#appearance');
    assertNoProblems(problems, '/sessions');
  });

  /** Below 1024px the rail is an overlay with a scrim, so Escape closes it like every other. */
  test('Escape closes the rail drawer and returns focus to its toggle', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openRoute(page, '/');
    const toggle = page.getByRole('button', { name: 'Show navigation' });
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show navigation' })).toBeFocused();
  });

  /**
   * Under 720px the bar has no room for its search field, so it steps aside — and `/` has to
   * reach the search page rather than focus something that is not laid out.
   */
  test('"/" opens the search page when the bar is too narrow for its field', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 800 });
    await openRoute(page, '/');
    await expect(page.locator('header[data-app-bar] input[type="search"]')).toBeHidden();

    await page.keyboard.press('/');
    await expect(page).toHaveURL(/\/search$/);
  });

  /**
   * `TopBar.module.css` used to hide the range outright under 1180px, which put the app's primary
   * filter out of reach on a 13" laptop while every empty state went on telling the reader to
   * widen it. It changes shape instead: one button naming the window, presets and bounds inside.
   */
  test('the date range changes shape at 1180px instead of disappearing', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 800 });
    await openRoute(page, '/');
    const bar = page.locator('header[data-app-bar]');
    const trigger = bar.getByRole('button', { name: /^Date range:/ });
    await expect(trigger).toBeVisible();

    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Date range' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '7 days' }).click();
    await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-\d{2}/);
  });

  test('the full preset row is in the bar above 1180px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoute(page, '/');
    const group = page.locator('header[data-app-bar]').getByRole('group', { name: 'Date range' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button', { name: '30 days' })).toBeVisible();
  });

  /** The search page owns a richer field of its own; two search boxes on one screen is one too many. */
  test('the top bar drops its search field on the search page', async ({ page }) => {
    await openRoute(page, '/');
    await expect(page.locator('header[data-app-bar] input[type="search"]')).toBeVisible();

    await openRoute(page, `/search?${ALL_TIME}`);
    await expect(page.locator('header[data-app-bar] input[type="search"]')).toHaveCount(0);
    await expect(page.locator('[data-page-search]')).toBeVisible();
  });

  test('"]" and "[" walk the transcript turns and take focus with them', async ({ page }) => {
    await openRoute(page, `/sessions/${A1}/transcript`);
    await expect(page.locator('[data-turn]').first()).toBeVisible();
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

    await page.keyboard.press(']');
    await expect.poll(async () => (await focused(page)).turn, { timeout: 5_000 }).toBe(true);
    const forward = (await focused(page)).name;

    await page.keyboard.press('[');
    await expect.poll(async () => (await focused(page)).name, { timeout: 5_000 }).not.toBe(forward);
    expect((await focused(page)).turn, 'still on a turn header').toBe(true);
  });
});

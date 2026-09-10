/**
 * Shared scaffolding for the Playwright suites.
 *
 * The server under test is booted by `playwright.config.ts` against `tests/fixtures/projects`
 * with `CCA_ALLOW_UNAUTH_STATUS=1`, so `/api/status` can be polled before the browser has
 * authenticated. The app itself bootstraps its session cookie before its first API call
 * (SPEC §7.3), so a plain `page.goto` is all a test needs.
 *
 * Page authors extend `ROUTES` and the per-route expectations here rather than repeating
 * navigation and error plumbing in every spec.
 */
// Named import: the package's CJS type entry does not expose a constructable default.
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Result } from 'axe-core';

/** Every page in SPEC §8.4, plus the design gallery. `:id` is filled in at run time. */
export const ROUTES = [
  { path: '/', name: 'overview' },
  { path: '/sessions', name: 'sessions' },
  { path: '/search', name: 'search' },
  { path: '/analytics/tools', name: 'analytics-tools' },
  { path: '/analytics/models', name: 'analytics-models' },
  { path: '/analytics/hooks', name: 'analytics-hooks' },
  { path: '/analytics/attribution', name: 'analytics-attribution' },
  { path: '/insights', name: 'insights' },
  { path: '/settings', name: 'settings' },
  { path: '/how-it-works', name: 'how-it-works' },
  { path: '/methodology', name: 'methodology' },
  { path: '/compare', name: 'compare' },
  { path: '/design', name: 'design' },
] as const;

const INDEXING_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 200;

export interface StatusShape {
  indexing: boolean;
  counts: { sessions: number; requests: number };
}

/** Polls `/api/status` until the boot index finishes and at least one session is in the DB. */
export async function waitForIndexed(request: APIRequestContext): Promise<StatusShape> {
  const deadline = Date.now() + INDEXING_TIMEOUT_MS;
  let last: StatusShape | null = null;
  while (Date.now() < deadline) {
    const response = await request.get('/api/status');
    expect(response.status(), 'GET /api/status').toBe(200);
    last = (await response.json()) as StatusShape;
    if (!last.indexing && last.counts.sessions > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`indexing did not settle within ${INDEXING_TIMEOUT_MS} ms (last: ${JSON.stringify(last)})`);
}

/**
 * Issues the session cookie on an API-only context (the browser does this itself on first load).
 * `Sec-Fetch-Site` is set because Playwright's request context omits it.
 */
export async function login(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/auth/session', { headers: { 'sec-fetch-site': 'same-origin' } });
  expect(response.status(), 'POST /api/auth/session').toBe(204);
}

/** The id of the fixture session with the most requests — the richest page to render. */
export async function firstSessionId(request: APIRequestContext): Promise<string> {
  await login(request);
  const response = await request.get('/api/sessions?from=2000-01-01&to=2100-01-01&limit=100&sort=cost');
  expect(response.status(), 'GET /api/sessions').toBe(200);
  const body = (await response.json()) as { sessions: { id: string }[] };
  const id = body.sessions[0]?.id;
  expect(id, 'fixture root has at least one session').toBeTruthy();
  return id as string;
}

export interface PageProblems {
  consoleErrors: string[];
  failedRequests: string[];
}

/**
 * No 4xx is tolerated. The SPA bootstraps its session cookie (`POST /api/auth/session`) before
 * its first API call (`web/src/lib/api.ts`), so a cold page load must not produce a single 401 —
 * the retry-on-401 path still exists, but only as a fallback, and reaching it is a defect.
 */

/** Starts collecting console errors and failed/4xx-5xx responses. Call before `page.goto`. */
export function watchForProblems(page: Page): PageProblems {
  const problems: PageProblems = { consoleErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    problems.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    problems.consoleErrors.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    // Navigations the test itself aborts (fast successive gotos) are not app failures.
    if (failure === 'net::ERR_ABORTED') return;
    problems.failedRequests.push(`${request.method()} ${new URL(request.url()).pathname} — ${failure}`);
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const path = new URL(response.url()).pathname;
    problems.failedRequests.push(`${response.request().method()} ${path} — ${status}`);
  });
  return problems;
}

/** Navigates and waits until the SPA has painted its first heading. */
export async function openRoute(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('main h1, h1').first()).toBeVisible({ timeout: 20_000 });
}

export function assertNoProblems(problems: PageProblems, where: string): void {
  expect(problems.consoleErrors, `console errors on ${where}`).toEqual([]);
  expect(problems.failedRequests, `failed requests on ${where}`).toEqual([]);
}

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/**
 * Lets every finite transition finish before a scan. axe judges the pixels that are on screen, so
 * a dialog caught halfway through its fade reports the contrast of half-transparent text — three
 * spurious `color-contrast` failures per dialog. Looping animations (the skeleton shimmer) are
 * excluded, because they never finish.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((animation) => {
          const iterations = animation.effect?.getComputedTiming().iterations ?? 1;
          return iterations === Infinity || animation.playState !== 'running';
        }),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {
      /* an animation that never settles is not a reason to skip the scan */
    });
}

/**
 * Fails with the rule ids when axe finds a serious or critical violation (SPEC §9). Shared so a
 * page suite can scan a state the route-level sweep in `a11y.spec.ts` never reaches — a table
 * flipped to its data view, a dialog, a populated combobox.
 */
export async function expectNoAxeViolations(page: Page, where: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking: Result[] = results.violations.filter((violation: Result) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ''),
  );
  expect(
    blocking.map((violation) => `${violation.id} (${violation.impact}) × ${violation.nodes.length}`),
    `serious/critical axe violations on ${where}`,
  ).toEqual([]);
}

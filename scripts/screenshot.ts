/**
 * Capture every page in both themes for review and the executive summary.
 * Usage: npx tsx scripts/screenshot.ts [--base http://127.0.0.1:4141] [--out docs/screenshots] [--themes paper,slate]
 * Requires a running server (npm start or npm run dev) that has finished indexing.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

interface Args { base: string; out: string; themes: string[] }

function parseArgs(argv: string[]): Args {
  const args: Args = { base: 'http://127.0.0.1:4141', out: 'docs/screenshots', themes: ['paper', 'slate'] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--base' && next) { args.base = next; i++; }
    else if (a === '--out' && next) { args.out = next; i++; }
    else if (a === '--themes' && next) { args.themes = next.split(',').map((s) => s.trim()).filter(Boolean); i++; }
  }
  return args;
}

const STATIC_PAGES: { name: string; path: string }[] = [
  { name: 'overview', path: '/' },
  { name: 'sessions', path: '/sessions' },
  { name: 'search', path: '/search?q=cost' },
  { name: 'analytics-tools', path: '/analytics/tools' },
  { name: 'analytics-models', path: '/analytics/models' },
  { name: 'analytics-hooks', path: '/analytics/hooks' },
  { name: 'analytics-attribution', path: '/analytics/attribution' },
  { name: 'insights', path: '/insights' },
  { name: 'settings', path: '/settings' },
  { name: 'how-it-works', path: '/how-it-works' },
  { name: 'methodology', path: '/methodology' },
  { name: 'design', path: '/design' },
];

/** The theme the executive summary's hero frames are cut from, and which pages they are. */
const HERO_THEME = 'paper';
const HERO_SOURCE = new Map([
  ['overview', 'overview'],
  ['session-summary', 'session'],
]);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const theme of args.themes) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme === 'slate' ? 'dark' : 'light' });
      await context.addInitScript((t: string) => {
        (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem('cca.theme', t);
      }, theme);
      const page = await context.newPage();
      // Bootstrap: load once so the app obtains its session cookie.
      await page.goto(`${args.base}/`, { waitUntil: 'networkidle' });

      const pages = [...STATIC_PAGES];
      const sessionsRes = await page.request.get(`${args.base}/api/sessions?sort=cost&limit=1`);
      if (sessionsRes.ok()) {
        const body = (await sessionsRes.json()) as { sessions?: { id: string }[] };
        const id = body.sessions?.[0]?.id;
        if (id) {
          pages.push({ name: 'session-summary', path: `/sessions/${id}` });
          pages.push({ name: 'session-transcript', path: `/sessions/${id}/transcript` });
          pages.push({ name: 'session-tools', path: `/sessions/${id}/tools` });
          pages.push({ name: 'session-agents', path: `/sessions/${id}/agents` });
          pages.push({ name: 'session-hooks', path: `/sessions/${id}/hooks` });
          pages.push({ name: 'session-timeline', path: `/sessions/${id}/timeline` });
        }
      }

      for (const p of pages) {
        await page.goto(`${args.base}${p.path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(400);
        const file = path.join(args.out, `${p.name}.${theme}.png`);
        await page.screenshot({ path: file, fullPage: false });
        process.stdout.write(`${file}\n`);
      }

      // Two extra frames for the executive summary: the same two pages, named so the report can
      // link them without knowing which theme the rest of the set was captured in.
      if (theme === HERO_THEME) {
        for (const hero of pages.filter((p) => HERO_SOURCE.has(p.name))) {
          await page.goto(`${args.base}${hero.path}`, { waitUntil: 'networkidle' });
          await page.waitForTimeout(600);
          const file = path.join(args.out, `hero-${HERO_SOURCE.get(hero.name)}.${theme}.png`);
          await page.screenshot({ path: file, fullPage: false });
          process.stdout.write(`${file}\n`);
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

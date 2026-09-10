/**
 * Splits a leading `# Title` off a Markdown document. The title becomes the page's lead
 * sentence — the `<h1>` on screen is the route's own name — and the body is what gets
 * rendered, so a doc page never shows two competing top-level headings.
 *
 * Its own module, with no imports: `tests/web/doc-page.test.ts` compiles under NodeNext with no
 * path aliases, so it has to be reachable without pulling in React or a CSS module.
 */
const TITLE_LINE = /^#\s+(.*)$/m;

export function splitTitle(source: string): { title: string | null; body: string } {
  const match = TITLE_LINE.exec(source);
  if (!match || match.index !== 0) return { title: null, body: source };
  return { title: (match[1] ?? '').trim(), body: source.slice(match[0].length) };
}

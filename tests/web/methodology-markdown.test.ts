/**
 * The Markdown subset that renders `docs/METHODOLOGY.md` (SPEC §8.4). The parser is pure, so it
 * is unit-tested here; the rendered page is covered by `tests/e2e/methodology.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref, slugify } from '../../web/src/components/DocPage/markdown.js';

const DOC = fileURLToPath(new URL('../../docs/METHODOLOGY.md', import.meta.url));

const kinds = (text: string): string[] => parseInline(text).map((token) => token.kind);

describe('slugify', () => {
  it('makes a heading into an id', () => {
    expect(slugify('Where the data comes from')).toBe('where-the-data-comes-from');
  });

  it('prefixes ids that would start with a digit', () => {
    // Legal HTML, but `#2-request-cost` is not a legal CSS selector.
    expect(slugify('2. Request cost (exact)')).toBe('s-2-request-cost-exact');
  });

  it('drops inline markup characters', () => {
    expect(slugify('**Bold** and `code`')).toBe('bold-and-code');
  });
});

describe('parseMarkdown', () => {
  it('reads ATX headings with their level', () => {
    expect(parseMarkdown('# One\n## Two\n### Three')).toEqual([
      { kind: 'heading', level: 1, text: 'One', slug: 'one' },
      { kind: 'heading', level: 2, text: 'Two', slug: 'two' },
      { kind: 'heading', level: 3, text: 'Three', slug: 'three' },
    ]);
  });

  it('joins the lines of a paragraph and splits on the blank line', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'one two' },
      { kind: 'paragraph', text: 'three' },
    ]);
  });

  it('keeps fenced code verbatim, with its language', () => {
    const blocks = parseMarkdown('```json\n{"a": 1}\n  indented\n```\nafter');
    expect(blocks[0]).toEqual({ kind: 'code', language: 'json', code: '{"a": 1}\n  indented' });
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: 'after' });
  });

  it('does not treat markup inside a fence as markup', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'code', code: '# not a heading\n- not a list' });
  });

  it('reads bullet and ordered lists, folding continuation lines into the item', () => {
    const blocks = parseMarkdown('- first\n  still first\n- second\n\n1. one\n2. two');
    expect(blocks[0]).toEqual({ kind: 'list', ordered: false, items: ['first still first', 'second'] });
    expect(blocks[1]).toEqual({ kind: 'list', ordered: true, items: ['one', 'two'] });
  });

  it('reads block quotes and thematic breaks', () => {
    expect(parseMarkdown('> quoted\n> more')).toEqual([{ kind: 'quote', text: 'quoted more' }]);
    expect(parseMarkdown('---')).toEqual([{ kind: 'rule' }]);
  });

  it('leaves HTML as text, so nothing in the source can become markup', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([{ kind: 'paragraph', text: '<script>alert(1)</script>' }]);
  });

  it('parses the document the app ships', () => {
    const blocks = parseMarkdown(readFileSync(DOC, 'utf8'));
    const kinds = new Set(blocks.map((block) => block.kind));
    expect(kinds).toContain('heading');
    expect(kinds).toContain('paragraph');
    expect(kinds).toContain('code');
    expect(kinds).toContain('list');
    // Every level-2 heading gets a unique id for the contents list.
    const slugs = blocks.flatMap((block) => (block.kind === 'heading' && block.level === 2 ? [block.slug] : []));
    expect(slugs.length).toBeGreaterThan(3);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('parseInline', () => {
  it('finds code spans, bold and links', () => {
    expect(kinds('plain `code` plain')).toEqual(['text', 'code', 'text']);
    expect(kinds('a **b** c')).toEqual(['text', 'strong', 'text']);
    expect(parseInline('see [docs](https://example.com/x)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://example.com/x' },
    ]);
  });

  it('does not interpret markup inside a code span', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ kind: 'code', text: '**not bold**' }]);
  });

  it('leaves a link with an unsafe scheme as literal text', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[click](javascript:alert(1)' },
      { kind: 'text', text: ')' },
    ]);
    expect(kinds('[click](javascript:alert(1))')).not.toContain('link');
  });
});

describe('safeHref', () => {
  it('allows http, https and in-app targets', () => {
    expect(safeHref('https://example.com/')).toBe('https://example.com/');
    expect(safeHref('/settings')).toBe('/settings');
    expect(safeHref('#section')).toBe('#section');
  });

  it('rejects every other scheme', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'not a url']) {
      expect(safeHref(href)).toBeNull();
    }
  });
});

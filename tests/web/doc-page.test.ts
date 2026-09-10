/**
 * `splitTitle` is what lets `docs/METHODOLOGY.md` and `docs/HOW-IT-WORKS.md` keep their own
 * `# Title` line while the rendered page shows the route's `<h1>` instead. Both shipped
 * documents are checked here, so a doc that loses its title line fails a test rather than
 * silently rendering two top-level headings.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splitTitle } from '../../web/src/components/DocPage/splitTitle.js';

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../../docs/${name}`, import.meta.url)), 'utf8');

describe('splitTitle', () => {
  it('takes the leading h1 as the title and leaves the rest as the body', () => {
    const { title, body } = splitTitle('# A title\n\nA paragraph.\n');
    expect(title).toBe('A title');
    expect(body.trimStart()).toBe('A paragraph.\n');
  });

  it('ignores an h1 that is not the first line', () => {
    const source = 'Intro.\n\n# Not the title\n';
    expect(splitTitle(source)).toEqual({ title: null, body: source });
  });

  it('leaves a document with no h1 untouched', () => {
    const source = '## Only a section\n';
    expect(splitTitle(source)).toEqual({ title: null, body: source });
  });

  it('never leaves an h1 in the body of a shipped document', () => {
    for (const name of ['METHODOLOGY.md', 'HOW-IT-WORKS.md']) {
      const { title, body } = splitTitle(read(name));
      expect(title, name).toBeTruthy();
      expect(body, name).not.toMatch(/^#\s/m);
      // The contents list is built from the level-2 headings, so every doc needs some.
      expect(body.match(/^##\s/gm)?.length ?? 0, name).toBeGreaterThan(2);
    }
  });
});

import { useMemo, type ReactNode } from 'react';
import { PageHeader } from '@/lib/page';
import { Markdown, parseMarkdown } from './markdown';
import { splitTitle } from './splitTitle.js';
import styles from './DocPage.module.css';

/**
 * A prose page rendered from a Markdown file the repo ships (`docs/METHODOLOGY.md`,
 * `docs/HOW-IT-WORKS.md`). Both pages use this one component so the document in the UI can
 * never drift from the one on disk, and so there is a single Markdown renderer, one contents
 * list and one set of prose styles rather than a copy per page.
 */
export interface DocPageProps {
  /** the route's name, shown as the `<h1>` */
  title: string;
  /** raw Markdown, imported with `?raw` */
  source: string;
  /** used when the document has no `# Title` line of its own */
  fallbackLead: string;
  /** repo-relative path, named in the footer note so a reader can find the source file */
  sourcePath: string;
  /** optional extra content between the header and the document */
  children?: ReactNode;
}

export function DocPage({ title, source, fallbackLead, sourcePath, children }: DocPageProps) {
  const { title: docTitle, body } = useMemo(() => splitTitle(source), [source]);
  const contents = useMemo(
    () => parseMarkdown(body).flatMap((block) => (block.kind === 'heading' && block.level === 2 ? [block] : [])),
    [body],
  );

  return (
    <div className="stack stack-lg">
      <PageHeader title={title} lead={docTitle ?? fallbackLead} />
      {children}

      <div className={styles.layout}>
        <article className={styles.doc}>
          <Markdown source={body} headingClassName={styles.heading} />
          <p className={styles.source}>
            Rendered from <code>{sourcePath}</code> in this repository. Nothing on this page is fetched or computed — it
            is the shipped document.
          </p>
        </article>

        <nav className={styles.contents} aria-labelledby="contents-heading">
          <h2 id="contents-heading" className={`eyebrow ${styles.contentsTitle}`}>
            Contents
          </h2>
          <ul className={styles.contentsList}>
            {contents.map((heading) => (
              <li key={heading.slug}>
                <a className={styles.contentsLink} href={`#${heading.slug}`}>
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

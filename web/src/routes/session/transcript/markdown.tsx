import { Fragment, type ReactNode } from 'react';
import styles from './markdown.module.css';

/**
 * A deliberately tiny Markdown subset: paragraphs, headings, bullet and ordered lists,
 * blockquotes, fenced code, inline code and bold. Everything is built as React elements —
 * transcript text never reaches the DOM as HTML, so a prompt containing markup cannot
 * become markup.
 */
type Block =
  | { type: 'p'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'rule' };

const BULLET = /^\s{0,3}([-*+])\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}```(.*)$/;
const RULE = /^\s{0,3}([-*_])\1{2,}\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'p', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ type: 'code', lang: (fence[1] ?? '').trim(), text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', text: heading[2] ?? '' });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const body = [quote[1] ?? ''];
      while (i + 1 < lines.length) {
        const next = QUOTE.exec(lines[i + 1] ?? '');
        if (!next) break;
        body.push(next[1] ?? '');
        i += 1;
      }
      blocks.push({ type: 'quote', text: body.join('\n') });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const isOrdered = Boolean(ordered);
      const items: string[] = [(bullet ?? ordered)?.[2] ?? ''];
      while (i + 1 < lines.length) {
        const candidate = lines[i + 1] ?? '';
        const nextItem = isOrdered ? ORDERED.exec(candidate) : BULLET.exec(candidate);
        if (nextItem) {
          items.push(nextItem[2] ?? '');
          i += 1;
          continue;
        }
        // A wrapped continuation line belongs to the item above it.
        if (/^\s{2,}\S/.test(candidate) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1] ?? ''} ${candidate.trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE = /`([^`]+)`|\*\*([\s\S]+?)\*\*/g;

/** Inline code and bold. Anything else is plain text. */
export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1] !== undefined) out.push(<code key={`${keyPrefix}-c${match.index}`}>{match[1]}</code>);
    else if (match[2] !== undefined) out.push(<strong key={`${keyPrefix}-b${match.index}`}>{match[2]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface MarkdownProps {
  text: string;
}

export function Markdown({ text }: MarkdownProps) {
  const blocks = parseMarkdown(text);
  return (
    <div className={styles.md}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case 'code':
            return (
              <pre key={key} className={styles.code} data-lang={block.lang || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          case 'heading':
            return (
              <p key={key} className={styles.heading}>
                {renderInline(block.text, key)}
              </p>
            );
          case 'quote':
            return (
              <blockquote key={key} className={styles.quote}>
                {renderInline(block.text, key)}
              </blockquote>
            );
          case 'rule':
            return <hr key={key} className={styles.rule} />;
          case 'list':
            return block.ordered ? (
              <ol key={key} className={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            );
          case 'p':
          default:
            return (
              <p key={key} className={styles.paragraph}>
                {block.text.split('\n').map((line, lineIndex) => (
                  <Fragment key={`${key}-${lineIndex}`}>
                    {lineIndex > 0 ? <br /> : null}
                    {renderInline(line, `${key}-${lineIndex}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

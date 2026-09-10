import { Fragment, type ReactNode } from 'react';

const ENTITY = /&(amp|lt|gt|quot|#39);/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const MARK = /<mark>([\s\S]*?)<\/mark>/g;

export function unescapeHtml(text: string): string {
  return text.replace(ENTITY, (_match, name: string) => ENTITIES[name] ?? _match);
}

/**
 * The API returns a snippet that is HTML-escaped except for `<mark>` around the matches.
 * We parse those markers ourselves and build elements: transcript text is never handed to
 * the DOM as HTML, so nothing in a prompt can become markup.
 */
export function renderSnippet(snippet: string, markClass: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  MARK.lastIndex = 0;
  while ((match = MARK.exec(snippet)) !== null) {
    if (match.index > last) out.push(<Fragment key={`t${last}`}>{unescapeHtml(snippet.slice(last, match.index))}</Fragment>);
    out.push(
      <mark key={`m${match.index}`} className={markClass}>
        {unescapeHtml(match[1] ?? '')}
      </mark>,
    );
    last = match.index + match[0].length;
  }
  if (last < snippet.length) out.push(<Fragment key={`t${last}`}>{unescapeHtml(snippet.slice(last))}</Fragment>);
  return out;
}

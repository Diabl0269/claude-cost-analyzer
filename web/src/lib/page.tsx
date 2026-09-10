/**
 * Page chrome shared by the analytics pages: the heading block, a titled section, and the
 * retryable error callout every page shows instead of throwing (SPEC §8.4).
 *
 * Deliberately styled with the global utilities (`stack`, `cluster`, `section-head`) only, so
 * it carries no stylesheet of its own.
 */
import type { ReactNode } from 'react';
import { Button, Callout } from '@/components';
import { ApiError } from './api';

export interface PageHeaderProps {
  title: string;
  /** one line under the heading: what the page answers, and for which window */
  lead?: ReactNode;
  /** controls that belong to the page as a whole (what-if, filters, exports) */
  actions?: ReactNode;
}

/** The single `<h1>` of a route, which the shell focuses after every navigation. */
export function PageHeader({ title, lead, actions }: PageHeaderProps) {
  return (
    <header className="stack stack-sm">
      <div className="cluster cluster-between">
        <h1>{title}</h1>
        {actions ? <div className="cluster">{actions}</div> : null}
      </div>
      {lead ? <p className="muted ui-sm">{lead}</p> : null}
    </header>
  );
}

export interface SectionProps {
  id?: string;
  title: string;
  /** short explanation shown next to the heading */
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** `<section>` with an `<h2>` the region is labelled by. */
export function Section({ id, title, note, actions, children }: SectionProps) {
  const headingId = `${id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="stack">
      <div className="section-head">
        <div className="cluster">
          <h2 id={headingId}>{title}</h2>
          {note ? <span className="muted-2 ui-xs">{note}</span> : null}
        </div>
        {actions ? <div className="cluster">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface QueryErrorProps {
  error: unknown;
  /** what failed to load, in the user's words ("the overview") */
  what: string;
  onRetry?: () => void;
}

/**
 * Partial-failure banner. Only the error *class* is shown — an API message can quote request
 * input, and transcript text must never reach an error string (docs/dev/web.md).
 */
export function QueryError({ error, what, onRetry }: QueryErrorProps) {
  const code = error instanceof ApiError ? error.code : 'unknown';
  return (
    <Callout
      tone="warn"
      title={`Could not load ${what}`}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null
      }
    >
      The local server refused or failed the request (<code>{code}</code>). It may still be indexing.
    </Callout>
  );
}

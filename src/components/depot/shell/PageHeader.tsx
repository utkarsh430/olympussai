import type { Provenance } from '@/lib/depot/types';
import { HeaderProvenance } from './HeaderProvenance';

/**
 * Opening block of every depot page: title, one sentence of prose, and the
 * page's controls aligned right. Controls wrap beneath the text on narrow widths.
 *
 * Pass `provenance` (rather than a tag in `children`) to place the page's tag
 * on its own line after the sentence, with what it applies to and the feed
 * time, the same on every page. Pages whose figures each carry their own tag
 * (the overview) pass none.
 */
export function PageHeader({
  title,
  description,
  provenance,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly provenance?: Provenance;
  readonly children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-2xl">
        <h1 className="depot-title">{title}</h1>
        <p className="depot-prose mt-1.5">{description}</p>
        {provenance ? <HeaderProvenance provenance={provenance} /> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

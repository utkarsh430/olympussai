'use client';

import { useEffect, useRef } from 'react';
import { FEED_STATUS_LABEL, type FeedEntry } from '@/lib/depot/sources/registry';
import { feedAnchor, feedIdFromHash, schemaSummary } from '@/lib/depot/sources/sourcesModel';

/**
 * A feed's section: its status, what it provides and unlocks, and its field list
 * inside a native disclosure (`<details>` gives the summary a real expanded state).
 * The section is the anchor `#feed-<id>` that other pages' "replaced when ... is
 * connected" links land on; arriving by that hash opens the disclosure. Opened, the
 * table grows to its full height in the page flow, so no inner scroll clips a row.
 */
export function FeedSchema({ feed, allIds }: { readonly feed: FeedEntry; readonly allIds: readonly string[] }) {
  const heading = feed.status === 'awaiting' ? 'Expected schema' : 'Fields read from this feed';
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const open = (): void => {
      if (feedIdFromHash(window.location.hash, allIds) === feed.id && details.current) {
        details.current.open = true;
        details.current.scrollIntoView?.({ block: 'start' });
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [feed.id, allIds]);

  return (
    <details
      ref={details}
      id={feedAnchor(feed.id)}
      className="group scroll-mt-[var(--depot-anchor-mt,5rem)]"
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1.5 font-sans text-sm text-depot-muted hover:text-depot-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block w-3 shrink-0 text-depot-faint group-open:rotate-90">
          ›
        </span>
        <span className="min-w-0 font-mono text-[13px] text-depot-ink">{feed.name}</span>
        <span className="min-w-0 underline-offset-2 group-hover:underline">{schemaSummary(feed)}</span>
      </summary>
      <div className="mb-3 ml-5 mt-1">
        <p className="depot-prose max-w-[62ch]">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-depot-faint">
            {FEED_STATUS_LABEL[feed.status]}
          </span>{' '}
          {feed.summary}
        </p>
        <p className="depot-prose mt-1 max-w-[62ch]">{`Unlocks: ${feed.unlocks}`}</p>
        <div className="depot-table-frame mt-2 !max-h-none">
          <table className="depot-table">
            <caption className="sr-only">{`${heading} for ${feed.name}`}</caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Type</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {feed.fields.map((field) => (
                <tr key={field.name}>
                  <th scope="row" className="!static !bg-transparent !text-left !normal-case !tracking-normal !text-depot-ink">
                    {field.name}
                  </th>
                  <td className="text-depot-muted">{field.type}</td>
                  <td className="depot-prose min-w-[16rem] !text-[13px]">{field.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

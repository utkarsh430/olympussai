import type { FeedEntry } from '@/lib/depot/sources/registry';
import { schemaSummary } from '@/lib/depot/sources/sourcesModel';

/**
 * A feed's field list inside a native disclosure: `<details>` gives the
 * summary a real expanded state for assistive tech. Opened, the table grows to
 * its full height in the page flow, so no inner scroll can clip a row.
 */
export function FeedSchema({ feed }: { readonly feed: FeedEntry }) {
  const heading = feed.status === 'awaiting' ? 'Expected schema' : 'Fields read from this feed';
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 font-sans text-sm text-depot-muted hover:text-depot-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block w-3 text-depot-faint group-open:rotate-90">
          ›
        </span>
        <span className="font-mono text-[13px] text-depot-ink">{feed.name}</span>
        <span className="underline-offset-2 group-hover:underline">{schemaSummary(feed)}</span>
      </summary>
      <div className="depot-table-frame mb-3 mt-2 !max-h-none">
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
    </details>
  );
}

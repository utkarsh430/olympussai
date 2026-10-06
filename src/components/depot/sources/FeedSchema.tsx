import type { FeedEntry } from '@/lib/depot/sources/registry';

/**
 * A feed's field list inside a disclosure, so the page stays scannable. For a
 * feed that is not connected yet this is the schema a real feed is expected to
 * provide.
 */
export function FeedSchema({ feed }: { readonly feed: FeedEntry }) {
  const heading =
    feed.status === 'awaiting' ? 'Expected schema' : 'Fields read from this feed';
  return (
    <details className="depot-details mt-3">
      <summary>{`${feed.name}: ${heading.toLowerCase()} · ${feed.fields.length} fields`}</summary>
      <div className="depot-table-frame mt-2 !max-h-[24rem]">
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

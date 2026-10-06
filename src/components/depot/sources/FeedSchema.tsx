import { FEED_STATUS_LABEL, type FeedEntry } from '@/lib/depot/sources/registry';

/**
 * A feed's field list, drawn inside its own feeds-table row when that row is expanded:
 * what the feed unlocks, then every field with its type and note. Opened, it grows in the
 * page flow, so no inner scroll clips a row.
 */
export function FeedSchema({ feed }: { readonly feed: FeedEntry }) {
  const heading = feed.status === 'awaiting' ? 'Expected schema' : 'Fields read from this feed';
  return (
    <div className="py-2" data-testid="depot-feed-fields">
      <p className="depot-prose max-w-[72ch] whitespace-normal">{`Unlocks: ${feed.unlocks}`}</p>
      <div className="depot-table-frame mt-2 !max-h-none">
        <table className="depot-table">
          <caption className="sr-only">{`${heading} for ${feed.name} (${FEED_STATUS_LABEL[feed.status]})`}</caption>
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
                <th
                  scope="row"
                  className="!static !bg-transparent !text-left !normal-case !tracking-normal !text-depot-ink"
                >
                  {field.name}
                </th>
                <td className="text-depot-muted">{field.type}</td>
                <td className="min-w-[16rem] whitespace-normal font-sans text-[13px]">
                  {field.note ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

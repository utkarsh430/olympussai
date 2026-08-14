import type { ReactNode } from 'react';

/**
 * Zero-JS search box for the (potentially thousands-of-rows) fleet views.
 * A plain GET form re-requests the same Server Component page with a `q`
 * query param, which the page filters server-side before rendering — no
 * client fetch, no shipping the whole fleet to the browser to filter there.
 *
 * `children` is for hidden fields the host page needs to survive that
 * navigation. A GET form submits ONLY its own fields, so any other query
 * parameter the page is currently rendering under - the control-room
 * console's open tab and selected corridor, for instance - is silently
 * dropped on submit unless it is carried here. That reads to an operator as
 * the console throwing away their place the moment they search.
 */
export function FleetSearchForm({
  query,
  resultCount,
  totalCount,
  children,
}: {
  query: string;
  resultCount: number;
  totalCount: number;
  children?: ReactNode;
}) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
      {children}
      <div className="flex-1 min-w-[220px]">
        <label
          htmlFor="fleet-search-q"
          className="ops-label mb-1 block"
        >
          Search registration, route or depot
        </label>
        <input
          id="fleet-search-q"
          name="q"
          type="text"
          defaultValue={query}
          placeholder="e.g. UP25FT4823 or a route name"
          className="ops-input"
        />
      </div>
      <button
        type="submit"
        className="ops-button px-4 py-2"
      >
        Search
      </button>
      <p className="w-full text-xs text-ops-faint">
        Showing {resultCount} of {totalCount} vehicles{query ? ` matching "${query}"` : ''}.
      </p>
    </form>
  );
}

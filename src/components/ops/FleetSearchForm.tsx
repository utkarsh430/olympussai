/**
 * Zero-JS search box for the (potentially thousands-of-rows) fleet views.
 * A plain GET form re-requests the same Server Component page with a `q`
 * query param, which the page filters server-side before rendering — no
 * client fetch, no shipping the whole fleet to the browser to filter there.
 */
export function FleetSearchForm({ query, resultCount, totalCount }: { query: string; resultCount: number; totalCount: number }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[220px]">
        <label
          htmlFor="fleet-search-q"
          className="mb-1 block font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]"
        >
          Search registration, route or depot
        </label>
        <input
          id="fleet-search-q"
          name="q"
          type="text"
          defaultValue={query}
          placeholder="e.g. UP25FT4823 or a route name"
          className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff]"
      >
        Search
      </button>
      <p className="w-full text-xs text-[#6f7684]">
        Showing {resultCount} of {totalCount} vehicles{query ? ` matching "${query}"` : ''}.
      </p>
    </form>
  );
}

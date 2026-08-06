import type { RouteDirectionMeta } from '@/models/control';

/** Zero-JS route-direction picker — same GET-form pattern as FleetSearchForm, so switching direction is a plain navigation, not a client fetch. */
export function RouteDirectionPicker({
  routeDirections,
  selectedId,
}: {
  routeDirections: RouteDirectionMeta[];
  selectedId: string | null;
}) {
  if (routeDirections.length === 0) return null;

  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-[260px]">
        <label
          htmlFor="observability-route-direction"
          className="mb-1 block font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]"
        >
          Route-direction
        </label>
        <select
          id="observability-route-direction"
          name="routeDirectionId"
          defaultValue={selectedId ?? undefined}
          className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
        >
          {routeDirections.map((rd) => (
            <option key={rd.routeDirectionId} value={rd.routeDirectionId}>
              {rd.routeId} · {rd.directionCode}
              {rd.isLoop ? ' (loop)' : ''}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff]"
      >
        View
      </button>
    </form>
  );
}

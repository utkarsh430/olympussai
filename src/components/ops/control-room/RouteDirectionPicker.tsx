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
          className="ops-label mb-1 block"
        >
          Route-direction
        </label>
        <select
          id="observability-route-direction"
          name="routeDirectionId"
          defaultValue={selectedId ?? undefined}
          className="ops-input"
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
        className="ops-button px-4 py-2"
      >
        View
      </button>
    </form>
  );
}

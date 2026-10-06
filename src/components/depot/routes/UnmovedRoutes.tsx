'use client';

import { useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { ALLOCATION_SUMMARY_QUERY, useAllocationList } from '@/hooks/useDepotAllocation';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import {
  outsideItem,
  stayItem,
  type UnmovedGroup,
  type UnmovedItem,
} from '@/lib/depot/routes/allocationGroups';
import { ROUTE_LIST_DEFAULT_LIMIT } from '@/lib/depot/routes/routeQuery';
import { offsetOf, serverPage } from '@/lib/depot/routes/routesPageModel';
import { ListPager } from './ListPager';
import { ROUTES_TEXT, disclosureWord } from '@/lib/depot/routes/routesPageText';
import { DepotLink } from './RouteCells';

/**
 * One page of one reason's routes, fetched from the server only while the
 * group is open, with the group's true total from the response.
 */
function GroupPage({
  group,
  onRetry,
}: {
  readonly group: UnmovedGroup;
  readonly onRetry: () => void;
}) {
  const [page, setPage] = useState(0);
  const limit = ROUTE_LIST_DEFAULT_LIMIT;
  const query = { ...ALLOCATION_SUMMARY_QUERY, reason: group.reason, offset: offsetOf(page, limit), limit };
  const list = useAllocationList(query);
  if (list.data === null) {
    return list.loading ? (
      <LoadingBlock rows={3} label={`Loading: ${group.heading}`} />
    ) : (
      <ErrorPanel message={list.error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={onRetry} />
    );
  }
  const stay = group.kind === 'stay';
  const items = stay ? list.data.unchanged.map(stayItem) : list.data.excluded.map(outsideItem);
  const total = stay ? list.data.unchangedTotal : list.data.excludedTotal;
  const current = serverPage(total, list.data.offset, list.data.limit);
  return (
    <>
      <GroupTable group={group} items={items} />
      {current.pageCount > 1 ? (
        <div className="mt-2">
          <ListPager
            label={`Pages of: ${group.heading}`}
            page={current.page}
            pageCount={current.pageCount}
            onPageChange={setPage}
          />
        </div>
      ) : null}
    </>
  );
}

function GroupTable({
  group,
  items,
}: {
  readonly group: UnmovedGroup;
  readonly items: readonly UnmovedItem[];
}) {
  const figures = group.kind === 'stay';
  return (
    <div role="region" aria-label={group.heading} tabIndex={0} className="depot-table-frame mt-2 max-h-[50vh]">
      <table className="depot-table">
        <caption className="sr-only">{`${group.countLabel}: ${group.heading}`}</caption>
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Depot</th>
            {figures ? (
              <>
                <th scope="col" className="depot-align-right">
                  <span className="inline-flex items-center gap-2">
                    Trips a day <ProvenanceBadge provenance="modelled" />
                  </span>
                </th>
                <th scope="col" className="depot-align-right">
                  <span className="inline-flex items-center gap-2">
                    Dead km a trip <ProvenanceBadge provenance="derived" />
                  </span>
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.routeName}>
              <td title={item.routeName}>
                <span className="block max-w-[16rem] truncate">{item.routeName}</span>
              </td>
              <td className="whitespace-nowrap">
                {item.depotId === null || item.depotName === null ? (
                  <span className="text-depot-muted">{ROUTES_TEXT.noSingleDepot}</span>
                ) : (
                  <DepotLink depotId={item.depotId} name={item.depotName} linked={item.linked} />
                )}
              </td>
              {figures ? (
                <>
                  <td className="depot-align-right">{item.trips}</td>
                  <td className="depot-align-right">{item.deadKmPerTrip}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupBlock({ group }: { readonly group: UnmovedGroup }) {
  const [open, setOpen] = useState(false);
  // A new key remounts the page, which fetches it again.
  const [attempt, setAttempt] = useState(0);
  return (
    <details
      className="depot-details border-b border-depot-line py-2.5"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular-nums">{group.countLabel}</span>
        <span className="min-w-0 font-sans text-sm normal-case tracking-normal text-depot-muted">
          {group.heading}
        </span>
        <span className="ml-auto">{disclosureWord(open)}</span>
      </summary>
      {open ? (
        <GroupPage key={attempt} group={group} onRetry={() => setAttempt((n) => n + 1)} />
      ) : null}
    </details>
  );
}

function GroupList({
  title,
  groups,
}: {
  readonly title: string;
  readonly groups: readonly UnmovedGroup[];
}) {
  if (groups.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="depot-label">{title}</h3>
      <div className="border-t border-depot-line">
        {groups.map((g) => (
          <GroupBlock key={g.reason} group={g} />
        ))}
      </div>
    </div>
  );
}

export interface UnmovedRoutesProps {
  /** Non-empty groups in reason precedence order; unprofiled routes are not among them. */
  readonly groups: readonly UnmovedGroup[];
}

/** Routes the plan does not move, by reason, collapsed until a reason is opened. */
export function UnmovedRoutes({ groups }: UnmovedRoutesProps) {
  return (
    <section aria-labelledby="unmoved-title" className="mb-10">
      <h2 id="unmoved-title" className="depot-section-label">
        {ROUTES_TEXT.unmovedTitle}
      </h2>
      {groups.length === 0 ? (
        <p className="depot-prose">{ROUTES_TEXT.unmovedNone}</p>
      ) : (
        <>
          <p className="depot-prose">{ROUTES_TEXT.unmovedHint}</p>
          <GroupList title={ROUTES_TEXT.stayTitle} groups={groups.filter((g) => g.kind === 'stay')} />
          <GroupList title={ROUTES_TEXT.outsideTitle} groups={groups.filter((g) => g.kind === 'outside')} />
        </>
      )}
    </section>
  );
}

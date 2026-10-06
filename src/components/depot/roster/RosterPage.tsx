'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { formatCount } from '@/lib/depot/format';
import {
  DEFAULT_ROSTER_FILTERS,
  buildRosterRows,
  countByState,
  filterRosterRows,
  type RosterFilters as Filters,
} from '@/lib/depot/roster/rosterModel';
import { BusDrawer } from './BusDrawer';
import { RosterFilters } from './RosterFilters';
import { RosterTable } from './RosterTable';

const BUS_PARAM = 'bus';

/**
 * Every bus homed at the depot, with filters, and one bus open in a side sheet.
 * The open bus lives in the URL (`?bus=`), so other pages can link to it; opening
 * and closing replace the entry, so Back leaves the page.
 */
export function RosterPage() {
  const { data, error, loading, refresh } = useDepotDetailContext();
  const router = useRouter();
  const pathname = usePathname();
  const openBus = useSearchParams().get(BUS_PARAM);
  const [filters, setFilters] = useState<Filters>(DEFAULT_ROSTER_FILTERS);
  const openerRef = useRef<HTMLElement | null>(null);

  const allRows = useMemo(() => (data ? buildRosterRows(data.buses) : []), [data]);
  const counts = useMemo(() => countByState(data?.buses ?? []), [data]);
  const rows = useMemo(() => filterRosterRows(allRows, filters), [allRows, filters]);

  const open = useCallback(
    (registration: string, opener: HTMLElement): void => {
      openerRef.current = opener;
      router.replace(`${pathname}?${BUS_PARAM}=${encodeURIComponent(registration)}`, {
        scroll: false,
      });
    },
    [router, pathname],
  );
  const close = useCallback((): void => {
    router.replace(pathname, { scroll: false });
    // The sheet unmounts first; hand focus back to the button that opened it.
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
  }, [router, pathname]);

  if (loading) return <LoadingBlock rows={10} label="Loading the roster" />;
  if (!data) return <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />;
  if (allRows.length === 0 && openBus === null) {
    return <EmptyState>The live feed lists no buses homed at this depot.</EmptyState>;
  }

  const openRow = allRows.find((row) => row.bus.registrationNumber === openBus) ?? null;
  return (
    <>
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <RosterFilters filters={filters} counts={counts} onChange={setFilters} />
      <p className="depot-prose mb-2 text-xs" role="status">
        {`Showing ${formatCount(rows.length)} of ${formatCount(allRows.length)} buses.`}
      </p>
      {rows.length === 0 ? (
        <EmptyState>
          {`No bus matches these filters. This depot has ${formatCount(allRows.length)} buses in all.`}
        </EmptyState>
      ) : (
        <RosterTable rows={rows} selectedRegistration={openBus} onOpen={open} />
      )}
      {openBus !== null ? (
        <BusDrawer registration={openBus} row={openRow} feedNow={data.feedNow} onClose={close} />
      ) : null}
    </>
  );
}

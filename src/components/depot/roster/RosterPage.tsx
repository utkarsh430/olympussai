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
  const regionRef = useRef<HTMLDivElement>(null);

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
  }, [router, pathname]);
  // The button that opened the sheet; for a `?bus=` deep link there is none, so
  // focus goes to the table region rather than falling to the body. Read, never
  // cleared here: strict mode runs the drawer's cleanup once at open, and clearing
  // would lose the opener before the real close. `open` replaces it for the next bus.
  const restoreFocusTo = useCallback((): HTMLElement | null => {
    const opener = openerRef.current;
    return opener?.isConnected ? opener : regionRef.current;
  }, []);

  if (loading) return <LoadingBlock rows={10} label="Loading the roster" />;
  if (!data) return (
      <ErrorPanel
        title="Could not load the roster"
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
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
      <div ref={regionRef} tabIndex={-1} aria-label="Roster results" className="outline-none">
        {rows.length === 0 ? (
          <EmptyState>
            {`No bus matches these filters. This depot has ${formatCount(allRows.length)} buses in all.`}
          </EmptyState>
        ) : (
          <RosterTable rows={rows} selectedRegistration={openBus} onOpen={open} />
        )}
      </div>
      {openBus !== null ? (
        <BusDrawer
          registration={openBus}
          row={openRow}
          feedNow={data.feedNow}
          onClose={close}
          restoreFocusTo={restoreFocusTo}
        />
      ) : null}
    </>
  );
}

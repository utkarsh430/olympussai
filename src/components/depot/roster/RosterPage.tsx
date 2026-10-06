'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, StaleStrip } from '@/components/depot/shell/DataStates';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { formatCount } from '@/lib/depot/format';
import { PAGE_ROWS, pageRange } from '@/lib/depot/listPaging';
import {
  DEFAULT_ROSTER_FILTERS as DEFAULT_FILTERS,
  buildRosterRows,
  countByState,
  filterRosterRows,
  type RosterFilters as Filters,
} from '@/lib/depot/roster/rosterModel';
import { parseRosterQuery, ROSTER_QUERY, rosterQueryString } from '@/lib/depot/roster/rosterQuery';
import { showRunningColumn } from '@/lib/depot/roster/rosterCells';
import { BusDrawer } from './BusDrawer';
import { RosterFilters } from './RosterFilters';
import { RosterTable } from './RosterTable';
import { usePhone } from './usePhone';

/**
 * Every bus homed at the depot, with filters, paged at 25 (the list is the page's
 * purpose, so it pages rather than scrolling a pane), and one bus open in a side
 * sheet. The filters and the open bus live in the URL (validated), so the cockpit
 * and other pages can link to a filtered roster or a bus; changes replace the
 * entry, so Back leaves the page.
 */
export function RosterPage() {
  const { data, error, loading, refresh } = useDepotDetailContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openBus = params.get(ROSTER_QUERY.bus);
  const urlFilters = useMemo(() => parseRosterQuery((key) => params.get(key)), [params]);
  // The search box types into local state (a controlled input bound to the URL alone
  // would drop keystrokes while a navigation is pending); the URL follows each change.
  const [searchDraft, setSearchDraft] = useState(urlFilters.search);
  const filters = useMemo(() => ({ ...urlFilters, search: searchDraft }), [urlFilters, searchDraft]);
  const [page, setPage] = useState(0);
  const phone = usePhone();
  const openerRef = useRef<HTMLElement | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);

  const allRows = useMemo(() => (data ? buildRosterRows(data.buses) : []), [data]);
  const counts = useMemo(() => countByState(data?.buses ?? []), [data]);
  const rows = useMemo(() => filterRosterRows(allRows, filters), [allRows, filters]);
  const showRunning = useMemo(() => showRunningColumn(rows), [rows]);

  const open = useCallback(
    (registration: string, opener: HTMLElement): void => {
      openerRef.current = opener;
      router.replace(`${pathname}${rosterQueryString(filters, registration)}`, { scroll: false });
    },
    [router, pathname, filters],
  );
  const close = useCallback((): void => {
    router.replace(`${pathname}${rosterQueryString(filters, null)}`, { scroll: false });
  }, [router, pathname, filters]);
  const setFilters = useCallback(
    (next: Filters): void => {
      setPage(0);
      setSearchDraft(next.search);
      router.replace(`${pathname}${rosterQueryString(next, openBus)}`, { scroll: false });
    },
    [router, pathname, openBus],
  );
  // The button that opened the sheet; for a `?bus=` deep link there is none, so
  // focus goes to the table region rather than falling to the body. Read, never
  // cleared here: strict mode runs the drawer's cleanup once at open, and clearing
  // would lose the opener before the real close. `open` replaces it for the next bus.
  const restoreFocusTo = useCallback((): HTMLElement | null => {
    const opener = openerRef.current;
    return opener?.isConnected ? opener : regionRef.current;
  }, []);

  if (loading) return <StatePanel kind="loading" rows={10} sentence="Loading the roster" />;
  if (!data) return (
      <ErrorPanel
        title="Could not load the roster"
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  if (allRows.length === 0 && openBus === null) {
    return (
      <StatePanel
        kind="empty"
        sentence="The live feed lists no buses homed at this depot."
        remedy="Buses appear here as soon as the feed homes one at this depot."
        action={
          <Link className="depot-link" href={`${DEPOTS_ROOT}/sources`}>
            Data sources
          </Link>
        }
      />
    );
  }

  const range = pageRange(page, rows.length);
  const openRow = allRows.find((row) => row.bus.registrationNumber === openBus) ?? null;
  return (
    <>
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <RosterFilters filters={filters} counts={counts} onChange={setFilters} />
      <p className="sr-only" role="status">
        {`${formatCount(rows.length)} of ${formatCount(allRows.length)} buses match the filters`}
      </p>
      <SectionLabel label="Roster" count={rows.length} />
      <div ref={regionRef} tabIndex={-1} aria-label="Roster results" className="min-w-0 outline-none">
        {rows.length === 0 ? (
          <StatePanel
            kind="empty"
            sentence={`No bus matches these filters. This depot has ${formatCount(allRows.length)} buses in all.`}
            remedy="Remove a state, a location or the search to see more of them."
            action={
              <button type="button" className="depot-filter-button" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Clear the filters
              </button>
            }
          />
        ) : (
          <>
            <RosterTable
              rows={rows.slice(range.start, range.end)}
              feedNow={data.feedNow}
              selectedRegistration={openBus}
              onOpen={open}
              phone={phone}
              showRunning={showRunning}
            />
            {rows.length > PAGE_ROWS ? (
              <Pager page={range.page} total={rows.length} onPage={setPage} />
            ) : null}
          </>
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

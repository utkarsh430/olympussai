'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { useDepotExceptions, DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotExceptions';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { DepotExceptionsResponse } from '@/lib/depot/api';
import { BUS_EXCEPTION_KINDS, BUS_PAGE_DEFAULT_LIMIT } from '@/lib/depot/exceptions/busPage';
import { EXCEPTION_KIND_LABEL } from '@/lib/depot/exceptions/describe';
import {
  depotScopeLine,
  exceptionTotalsLine,
  failedQuerySentence,
  groupDepotExceptions,
  severitySections,
} from '@/lib/depot/exceptions/pageModel';
import { exceptionPageScope } from '@/lib/depot/exceptions/pageScope';
import { entryParams, exceptionSearch, type ExceptionEntry } from '@/lib/depot/exceptions/pageParams';
import { depotWindowNote } from '@/lib/depot/score/windowWords';
import type {
  BusExceptionKind,
  DepotExceptionKind,
  ExceptionKind,
} from '@/lib/depot/exceptions/types';
import { BusExceptionSection } from './BusExceptionSection';
import { DepotExceptionList } from './DepotExceptionList';
import { ExceptionCounts } from './ExceptionCounts';

const HOW_PRODUCED: readonly string[] = [
  'A depot is flagged when its dark, off-road or on-road rate is both statistically unusual against its peers and at least 10 points from the peer median; critical at the statistical ceiling. Power-cut clusters need at least 3 buses and 10% of the fleet.',
  "Rates and peer medians are summed over a rolling window of the feed's own snapshots, the section note says the window, and a depot new to the window says how few snapshots it was scored on. The number of buses affected, and every bus exception, is as of the feed time. Bus exceptions are paged 25 at a time by the server.",
  'Exceptions name depots and vehicles, never a person.',
];

function isBusKind(kind: ExceptionKind | null): kind is BusExceptionKind {
  return BUS_EXCEPTION_KINDS.some((k) => k === kind);
}

/** Depots and buses that need attention on this snapshot, in plain sentences. */
export function ExceptionCentre() {
  // `?kind=` and `?depot=` (the overview and the depot cockpit link here) are the filters.
  // They are read from the router's search parameters, never from the address bar: on a
  // client navigation the router renders the new page before the address bar changes, and
  // a link to the bare page does not remount this one. Read before the first fetch, so no
  // unfiltered request goes out.
  const search = useSearchParams().toString();
  const { kind, depotId } = useMemo(() => entryParams(search), [search]);
  // The bus page offset belongs to one pair of filters: a new pair starts at the first page.
  const filterKey = `${kind ?? ''}|${depotId ?? ''}`;
  const [paging, setPaging] = useState({ filterKey, offset: 0 });
  const offset = paging.filterKey === filterKey ? paging.offset : 0;
  const setOffset = (next: number): void => setPaging({ filterKey, offset: next });
  const busKind = isBusKind(kind) ? kind : null;
  const depotKind: DepotExceptionKind | null = kind !== null && !isBusKind(kind) ? kind : null;
  const query = useMemo(
    () => ({ kind: busKind, depotId, offset, limit: BUS_PAGE_DEFAULT_LIMIT }),
    [busKind, depotId, offset],
  );
  const { data, error, loading, refresh } = useDepotExceptions(query);
  const network = useDepotNetworkContext();

  // A new query is a new URL, which reports loading with no data: keep the
  // last answer on screen meanwhile so paging does not blank the page, and keep
  // it when that query fails, with the reason beside it.
  const lastGood = useRef<DepotExceptionsResponse | null>(null);
  useEffect(() => {
    if (data) lastGood.current = data;
  }, [data]);
  const shown = data ?? lastGood.current;
  const failure = data === null && !loading ? error : null;

  const scope = useMemo(
    () => (shown ? exceptionPageScope(shown, depotId, depotKind) : null),
    [shown, depotId, depotKind],
  );
  const groups = useMemo(
    () => (scope ? groupDepotExceptions(scope.depotList, depotKind) : []),
    [scope, depotKind],
  );
  const sections = useMemo(() => severitySections(groups), [groups]);
  const scopeLine = depotScopeLine(groups);

  // The filters live in the URL alone, so a filtered view can be shared and the back
  // button steps through them. The router keeps its search parameters in step with
  // pushState, so writing the URL is what changes the filters.
  const pushFilters = (next: ExceptionEntry): void => {
    const query = exceptionSearch(search, next);
    window.history.pushState(null, '', `${window.location.pathname}${query}`);
  };
  const toggleKind = (next: ExceptionKind): void => {
    pushFilters({ kind: kind === next ? null : next, depotId });
  };
  const chooseDepot = (next: string | null): void => {
    pushFilters({ kind, depotId: next });
  };

  if (!shown || !scope) {
    if (loading) return <LoadingBlock rows={8} label="Loading exceptions" />;
    return (
      <ErrorPanel
        title="Could not load exceptions"
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }

  const { report } = shown;
  // Nothing flagged anywhere: one state line replaces a band of zeros (zeros read as findings).
  const nothingFlagged =
    kind === null && depotId === null && Object.values(report.counts).every((n) => n === 0);
  if (nothingFlagged) {
    return (
      <>
        {shown.stale || error ? <StaleStrip since={shown.feedNow} /> : null}
        <StatePanel
          kind="empty"
          sentence="Nothing stands out on this snapshot: no depot and no bus is flagged."
          remedy="A depot is listed when a rate moves far from its peers; a bus when it goes dark, loses main power or reports a tamper code or the emergency flag."
          howLink={{ label: 'How exceptions are found', targetId: 'how-produced' }}
        />
        <HowProduced id="how-produced" testId="depot-produced" className="mt-10" paragraphs={HOW_PRODUCED} />
      </>
    );
  }
  return (
    <>
      {shown.stale || error ? <StaleStrip since={shown.feedNow} /> : null}
      {failure !== null ? (
        <p role="alert" className="depot-prose mb-3 flex flex-wrap items-center gap-3">
          {failedQuerySentence(failure)}
          <button type="button" onClick={refresh} className="depot-filter-button">
            Retry
          </button>
        </p>
      ) : null}
      {scope.depotName === null ? null : (
        <p className="depot-prose mb-3 flex flex-wrap items-center gap-3" data-testid="depot-exception-scope">
          <span>{`Exceptions at ${scope.depotName} only.`}</span>
          <button
            type="button"
            data-testid="bus-depot-chip"
            aria-label={`Clear the depot filter ${scope.depotName}: show every depot`}
            onClick={() => chooseDepot(null)}
            className="depot-filter-button font-mono text-[11px] uppercase tracking-wider"
          >
            {scope.depotName} <span aria-hidden>×</span>
          </button>
        </p>
      )}
      <ExceptionCounts
        counts={scope.counts}
        selected={kind}
        onToggle={toggleKind}
        totalsLine={exceptionTotalsLine(scope.depotList, scope.busTotal, scope.busSeverity)}
      />
      <SectionLabel
        label="Depot exceptions"
        count={scope.depotCount}
        note={depotWindowNote(shown.scoreWindow, shown.feedNow)}
      />
      {scopeLine === '' ? null : <p className="depot-prose mb-2">{scopeLine}</p>}
      <DepotExceptionList
        sections={sections}
        filterLabel={depotKind === null ? null : EXCEPTION_KIND_LABEL[depotKind]}
        window={shown.scoreWindow}
        feedNow={shown.feedNow}
      />

      <BusExceptionSection
        page={shown.busPage}
        pending={loading}
        depots={network.data?.depots ?? []}
        depotId={depotId}
        feedNow={shown.feedNow}
        onDepotChange={chooseDepot}
        onOffsetChange={setOffset}
        kindTotals={scope.counts}
      />

      <HowProduced id="how-produced" testId="depot-produced" className="mt-10" paragraphs={HOW_PRODUCED} />
    </>
  );
}

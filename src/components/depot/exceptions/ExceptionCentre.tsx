'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { useDepotExceptions, DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotExceptions';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { HowProduced } from '@/components/depot/shell/HowProduced';
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
  "Rates and peer medians are summed over a rolling window of the feed's own snapshots, so each depot exception says the window it was compared over; a depot new to the window says how few snapshots it was scored on. The number of buses affected, and every bus exception, is as of the feed time. Bus exceptions are paged 25 at a time by the server.",
  'Exceptions name depots and vehicles, never a person.',
];

function isBusKind(kind: ExceptionKind | null): kind is BusExceptionKind {
  return BUS_EXCEPTION_KINDS.some((k) => k === kind);
}

function initialEntry(): ExceptionEntry {
  if (typeof window === 'undefined') return { kind: null, depotId: null };
  return entryParams(window.location.search);
}

/** Depots and buses that need attention on this snapshot, in plain sentences. */
export function ExceptionCentre() {
  // `?kind=` and `?depot=` (the overview and the depot cockpit link here) set the first
  // filters. Read before the first fetch, so no unfiltered request goes out. On the server
  // there is no URL; the loading markup is the same either way, so hydration agrees.
  const [entry] = useState<ExceptionEntry>(initialEntry);
  const [kind, setKind] = useState<ExceptionKind | null>(entry.kind);
  const [depotId, setDepotId] = useState<string | null>(entry.depotId);
  const [offset, setOffset] = useState(0);
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

  const groups = useMemo(
    () => (shown ? groupDepotExceptions(shown.report.depot, depotKind) : []),
    [shown, depotKind],
  );
  const sections = useMemo(() => severitySections(groups), [groups]);
  const scopeLine = depotScopeLine(groups);

  useEffect(() => {
    const onPop = (): void => {
      const next = initialEntry();
      setKind(next.kind);
      setDepotId(next.depotId);
      setOffset(0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The filters are written to the URL, so a filtered view can be shared and the back
  // button steps through them.
  const pushFilters = (next: ExceptionEntry): void => {
    const search = exceptionSearch(window.location.search, next);
    window.history.pushState(null, '', `${window.location.pathname}${search}`);
  };
  const toggleKind = (next: ExceptionKind): void => {
    const target = kind === next ? null : next;
    setKind(target);
    setOffset(0);
    pushFilters({ kind: target, depotId });
  };
  const chooseDepot = (next: string | null): void => {
    setDepotId(next);
    setOffset(0);
    pushFilters({ kind, depotId: next });
  };

  if (!shown) {
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
      <ExceptionCounts
        counts={report.counts}
        selected={kind}
        onToggle={toggleKind}
        totalsLine={exceptionTotalsLine(report.depot, report.busTotal, shown.busSeverityCounts)}
      />

      <SectionLabel
        label="Depot exceptions"
        count={report.depot.length}
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
      />

      <HowProduced testId="depot-produced" className="mt-10" paragraphs={HOW_PRODUCED} />
    </>
  );
}

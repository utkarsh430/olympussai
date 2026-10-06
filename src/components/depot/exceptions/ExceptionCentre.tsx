'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { useDepotExceptions, DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotExceptions';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import type { DepotExceptionsResponse } from '@/lib/depot/api';
import { BUS_EXCEPTION_KINDS, BUS_PAGE_DEFAULT_LIMIT } from '@/lib/depot/exceptions/busPage';
import { EXCEPTION_KIND_LABEL } from '@/lib/depot/exceptions/describe';
import {
  exceptionTotalsLine,
  failedQuerySentence,
  groupDepotExceptions,
  parseKindParam,
  severitySections,
} from '@/lib/depot/exceptions/pageModel';
import type {
  BusExceptionKind,
  DepotExceptionKind,
  ExceptionKind,
} from '@/lib/depot/exceptions/types';
import { BusExceptionSection } from './BusExceptionSection';
import { DepotExceptionList } from './DepotExceptionList';
import { ExceptionCounts } from './ExceptionCounts';

function isBusKind(kind: ExceptionKind | null): kind is BusExceptionKind {
  return BUS_EXCEPTION_KINDS.some((k) => k === kind);
}

function initialKind(): ExceptionKind | null {
  if (typeof window === 'undefined') return null;
  return parseKindParam(new URLSearchParams(window.location.search).get('kind'));
}

/** Depots and buses that need attention on this snapshot, in plain sentences. */
export function ExceptionCentre() {
  // `?kind=` (the overview links here) sets the first filter. Read before the
  // first fetch, so no unfiltered request goes out. On the server there is no
  // URL; the loading markup is the same either way, so hydration agrees.
  const [kind, setKind] = useState<ExceptionKind | null>(initialKind);
  const [depotId, setDepotId] = useState<string | null>(null);
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

  const sections = useMemo(
    () => (shown ? severitySections(groupDepotExceptions(shown.report.depot, depotKind)) : []),
    [shown, depotKind],
  );

  const toggleKind = (next: ExceptionKind): void => {
    setKind((current) => (current === next ? null : next));
    setOffset(0);
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

      <h2 className="depot-label mb-2">Depot exceptions</h2>
      <DepotExceptionList
        sections={sections}
        filterLabel={depotKind === null ? null : EXCEPTION_KIND_LABEL[depotKind]}
      />

      <BusExceptionSection
        page={shown.busPage}
        pending={loading}
        depots={network.data?.depots ?? []}
        depotId={depotId}
        onDepotChange={(next) => {
          setDepotId(next);
          setOffset(0);
        }}
        onOffsetChange={setOffset}
      />
    </>
  );
}

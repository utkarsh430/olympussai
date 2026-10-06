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

/** Depots and buses that need attention on this snapshot, in plain sentences. */
export function ExceptionCentre() {
  const [kind, setKind] = useState<ExceptionKind | null>(null);
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

  // `?kind=` (the overview links here) sets the first filter. Read once after
  // mount so the server and first client render agree.
  useEffect(() => {
    setKind(parseKindParam(new URLSearchParams(window.location.search).get('kind')));
  }, []);

  // A new query is a new URL, which reports loading with no data: keep the
  // last answer on screen meanwhile so paging does not blank the page.
  const lastGood = useRef<DepotExceptionsResponse | null>(null);
  useEffect(() => {
    if (data) lastGood.current = data;
  }, [data]);
  const shown = data ?? (loading ? lastGood.current : null);

  const sections = useMemo(
    () => (shown ? severitySections(groupDepotExceptions(shown.report.depot, depotKind)) : []),
    [shown, depotKind],
  );

  const toggleKind = (next: ExceptionKind): void => {
    setKind((current) => (current === next ? null : next));
    if (isBusKind(next)) setOffset(0);
  };

  if (!shown) {
    if (loading) return <LoadingBlock rows={8} label="Loading exceptions" />;
    return <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />;
  }

  const { report } = shown;
  return (
    <>
      {shown.stale || error ? <StaleStrip since={shown.feedNow} /> : null}
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

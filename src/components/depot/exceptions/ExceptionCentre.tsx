'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { useDepotExceptions, DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotExceptions';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { EXCEPTION_KIND_LABEL, describeEmptyBusList } from '@/lib/depot/exceptions/describe';
import type { BusExceptionKind } from '@/lib/depot/exceptions/types';
import { formatCount } from '@/lib/depot/format';
import { BusExceptionTable } from './BusExceptionTable';
import { DepotExceptionList } from './DepotExceptionList';
import { ExceptionCounts } from './ExceptionCounts';

const BUS_KINDS: readonly BusExceptionKind[] = [
  'long_dark',
  'power_cut',
  'tamper_code',
  'emergency',
];
const ANY = 'any';
const NO_DEPOT = 'none';

function isBusKind(value: string): value is BusExceptionKind {
  return BUS_KINDS.some((kind) => kind === value);
}

/** Depots and buses that need attention on this snapshot, in plain sentences. */
export function ExceptionCentre() {
  const { data, error, loading, refresh } = useDepotExceptions();
  const [kind, setKind] = useState<BusExceptionKind | typeof ANY>(ANY);
  const [depot, setDepot] = useState<string>(ANY);

  const bus = useMemo(() => data?.report.bus ?? [], [data]);
  const network = useDepotNetworkContext();
  // Every depot, not only those with rows in the capped list, so a depot whose
  // exceptions all fall beyond the cap can still be chosen.
  const depotOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const d of network.data?.depots ?? []) byId.set(d.id, d.name);
    for (const row of bus) {
      const id = row.depotId ?? NO_DEPOT;
      if (!byId.has(id)) byId.set(id, row.depotName ?? 'No home depot');
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'en'));
  }, [network.data, bus]);
  // A poll can remove the chosen depot from the options; fall back to all depots.
  useEffect(() => {
    if (depot !== ANY && !depotOptions.some(([id]) => id === depot)) setDepot(ANY);
  }, [depot, depotOptions]);
  const filtered = useMemo(
    () =>
      bus.filter(
        (row) =>
          (kind === ANY || row.kind === kind) && (depot === ANY || (row.depotId ?? NO_DEPOT) === depot),
      ),
    [bus, kind, depot],
  );

  if (loading) return <LoadingBlock rows={8} label="Loading exceptions" />;
  if (!data) {
    return <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />;
  }

  const { report } = data;
  const capped = report.busTotal > bus.length;

  return (
    <>
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <ExceptionCounts counts={report.counts} />

      <h2 className="depot-label mb-2">Depot exceptions</h2>
      <DepotExceptionList exceptions={report.depot} />

      <h2 className="depot-label mb-2 mt-8">Bus exceptions</h2>
      <form
        aria-label="Filter bus exceptions"
        className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="flex flex-col gap-1">
          <span className="depot-label">Kind</span>
          <select
            className="depot-field"
            value={kind}
            onChange={(event) => {
              const next = event.target.value;
              setKind(isBusKind(next) ? next : ANY);
            }}
          >
            <option value={ANY}>All kinds</option>
            {BUS_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXCEPTION_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="depot-label">Depot</span>
          <select
            className="depot-field max-w-full"
            value={depot}
            onChange={(event) => setDepot(event.target.value)}
          >
            <option value={ANY}>All depots</option>
            {depotOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </form>
      <p className="depot-prose mb-2 text-xs" role="status">
        {capped
          ? `Showing ${formatCount(bus.length)} of ${formatCount(report.busTotal)} buses. The list is capped, so a filter only searches those ${formatCount(bus.length)}; the counts above are complete.`
          : `Showing ${formatCount(filtered.length)} of ${formatCount(report.busTotal)} buses.`}
        {capped && filtered.length !== bus.length
          ? ` ${formatCount(filtered.length)} match the filters.`
          : ''}
      </p>
      <BusExceptionTable
        rows={filtered}
        emptyMessage={describeEmptyBusList(bus.length, report.busTotal)}
      />
    </>
  );
}

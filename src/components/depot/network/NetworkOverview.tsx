'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import {
  formatIndex,
  joinScores,
  rankedIndex,
  unpositionedCount,
  unrankedReason,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';
import type { DepotNetworkResponse } from '@/lib/depot/api';
import { DepotMap } from './DepotMap';
import { DepotMapLegend } from './DepotMapLegend';
import { DepotMapPanel } from './DepotMapPanel';
import { DepotTable } from './DepotTable';
import { ExceptionSummary } from './ExceptionSummary';
import { KpiBand } from './KpiBand';
import { RankedStrip } from './RankedStrip';

const SECTION = 'animate-rise';

function OverviewLoading() {
  return (
    <div className="space-y-8" data-testid="depot-overview-loading">
      <LoadingBlock rows={2} rowHeight={104} label="Loading network figures" />
      <div className="depot-map-layout">
        <LoadingBlock rows={1} rowHeight={460} label="Loading the depot map" />
        <LoadingBlock rows={1} rowHeight={460} label="Loading the depot summary" />
      </div>
      <LoadingBlock rows={6} label="Loading the ranked depots" />
      <LoadingBlock rows={3} label="Loading exceptions" />
      <LoadingBlock rows={8} label="Loading the depot table" />
    </div>
  );
}

interface MapSectionProps {
  readonly rows: readonly DepotRow[];
  readonly selectedId: string | null;
  /** Null clears the selection. */
  readonly onSelect: (depotId: string | null) => void;
  readonly vanished: boolean;
}

function MapSection({ rows, selectedId, onSelect, vanished }: MapSectionProps) {
  const depots = rows.map((row) => row.depot);
  const missing = unpositionedCount(depots);
  const maxFleet = depots.reduce(
    (max, depot) => (depot.centroid ? Math.max(max, depot.fleet) : max),
    0,
  );
  const selected = rows.find((row) => row.depot.id === selectedId) ?? null;

  return (
    <section aria-labelledby="depot-map-heading" className={SECTION}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-map-heading" className="depot-section-label !mb-0">
          Depot map
        </h2>
        <ProvenanceBadge provenance="derived" />
        <p className="font-sans text-xs text-depot-muted">
          Each depot is drawn at the median position of its buses, not at a surveyed yard, and it
          moves with them: a depot whose fleet is mostly out on routes can appear tens of kilometres
          from its yard.
        </p>
      </div>
      <div className="depot-map-layout">
        <div className="min-w-0">
          <DepotMap rows={rows} maxFleet={maxFleet} selectedId={selectedId} onSelect={onSelect} />
          <p className="mt-2 text-[11px] text-depot-faint" data-testid="depot-map-unpositioned">
            {missing === 0
              ? 'Every depot has at least one positioned bus.'
              : `${missing} ${missing === 1 ? 'depot has' : 'depots have'} no positioned buses and ${missing === 1 ? 'is' : 'are'} not on the map.`}
          </p>
          <div className="mt-3">
            <DepotMapLegend maxFleet={maxFleet} />
          </div>
        </div>
        <DepotMapPanel row={selected} vanished={vanished} onClear={() => onSelect(null)} />
      </div>
    </section>
  );
}

function showOnMap(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById('depot-map-heading')
    ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  document.getElementById('depot-panel-heading')?.focus({ preventScroll: true });
}

/** Says what a click in the table or strip did, right where the click happened. */
function SelectionBar({ row }: { readonly row: DepotRow }) {
  const index = rankedIndex(row);
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-y border-depot-line py-1.5">
      <span className="depot-label">Selected</span>
      <span className="min-w-0 truncate text-[13px] text-depot-ink">{row.depot.name}</span>
      <span className="text-[11px] text-depot-muted">
        {index === null ? `Not ranked: ${unrankedReason(row)}` : `Index ${formatIndex(index)}`}
      </span>
      <button type="button" onClick={showOnMap} className="depot-filter-button ml-auto">
        Show on map
      </button>
    </div>
  );
}

function OverviewBody({ data }: { readonly data: DepotNetworkResponse }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(() => joinScores(data.depots, data.scores), [data.depots, data.scores]);
  const [vanished, setVanished] = useState(false);
  const select = useCallback((depotId: string | null) => {
    setSelectedId(depotId);
    setVanished(false);
  }, []);
  const selected = rows.find((row) => row.depot.id === selectedId) ?? null;

  // A poll can drop the selected depot; say so instead of showing nothing.
  useEffect(() => {
    if (selectedId === null || selected) return;
    setSelectedId(null);
    setVanished(true);
  }, [selectedId, selected]);

  return (
    <div className="space-y-8">
      <div className={SECTION}>
        <KpiBand kpis={data.kpis} />
      </div>
      {rows.length === 0 ? (
        <EmptyState>
          The feed returned no depots on this snapshot, so there is nothing to map, rank or list.
        </EmptyState>
      ) : (
        <>
          <MapSection rows={rows} selectedId={selectedId} onSelect={select} vanished={vanished} />
          <div className={SECTION}>
            <RankedStrip rows={rows} selectedId={selectedId} onSelect={select} />
          </div>
          <div className={SECTION}>
            <ExceptionSummary
              counts={data.exceptionCounts}
              severities={data.exceptionSeverityCounts}
            />
          </div>
          <div className={SECTION}>
            {selected ? <SelectionBar row={selected} /> : null}
            <DepotTable rows={rows} selectedId={selectedId} onSelect={select} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The network overview: KPI band, depot map with its summary panel, ranked
 * depots, exceptions and the depot table, all from the shell's single poll.
 * There is always something on screen: placeholders, an error with Retry, or
 * the last good data under a stale strip.
 */
export function NetworkOverview() {
  const { data, error, loading, refresh } = useDepotNetworkContext();

  if (!data) {
    if (loading || !error) return <OverviewLoading />;
    return (
      <ErrorPanel
        message={`${error}. The overview will appear once the feed answers.`}
        onRetry={refresh}
      />
    );
  }

  return (
    <div data-testid="depot-overview">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <OverviewBody data={data} />
    </div>
  );
}

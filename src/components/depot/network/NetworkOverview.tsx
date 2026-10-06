'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatClockTime } from '@/lib/depot/format';
import { loadErrorBody } from '@/lib/depot/loadError';
import { unpositionedSentence } from '@/lib/depot/network/mapWords';
import { joinScores, unpositionedCount, type DepotRow } from '@/lib/depot/network/overviewModel';
import type { DepotNetworkResponse } from '@/lib/depot/api';
import { DepotMap } from './DepotMap';
import { DepotMapLegend } from './DepotMapLegend';
import { DepotMapPanel } from './DepotMapPanel';
import { DepotTable } from './DepotTable';
import { ExceptionSummary } from './ExceptionSummary';
import { KpiBand } from './KpiBand';
import { RankedStrip } from './RankedStrip';
import { SelectionBar, SelectionLine } from './SelectionBar';

const SECTION = 'animate-rise';
const OPERATIONS_HREF = '/project/upsrtc';

function OverviewLoading() {
  return (
    <div className="space-y-8" data-testid="depot-overview-loading">
      <LoadingBlock rows={2} rowHeight={72} label="Loading network figures" />
      <div className="depot-map-layout">
        <LoadingBlock rows={1} rowHeight={460} label="Loading the depot map" />
        <LoadingBlock rows={1} rowHeight={220} label="Loading the depot summary" />
      </div>
      <LoadingBlock rows={6} label="Loading the ranked depots" />
      <LoadingBlock rows={4} label="Loading exceptions" />
      <LoadingBlock rows={8} label="Loading the units table" />
    </div>
  );
}

interface MapSectionProps {
  readonly rows: readonly DepotRow[];
  readonly selected: DepotRow | null;
  /** Null clears the selection. */
  readonly onSelect: (depotId: string | null) => void;
  readonly vanished: boolean;
}

function MapSection({ rows, selected, onSelect, vanished }: MapSectionProps) {
  const depots = rows.map((row) => row.depot);
  const maxFleet = depots.reduce(
    (max, depot) => (depot.centroid ? Math.max(max, depot.fleet) : max),
    0,
  );
  const clear = (): void => onSelect(null);

  return (
    <section aria-labelledby="depot-map-heading" className={SECTION}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-map-heading" className="depot-section-label !mb-0">
          Depot map
        </h2>
        <ProvenanceBadge provenance="derived" />
        <p className="font-sans text-[13px] leading-snug text-depot-muted">
          Each depot is drawn at the median position of its buses, not at a surveyed yard, and it
          moves with them: a depot whose fleet is mostly out on routes can appear tens of kilometres
          from its yard.
        </p>
      </div>
      <SelectionLine row={selected} onClear={clear} />
      <div className="depot-map-layout">
        <div className="min-w-0">
          <DepotMap
            rows={rows}
            maxFleet={maxFleet}
            selectedId={selected?.depot.id ?? null}
            onSelect={onSelect}
          />
          <p
            className="mt-2 font-sans text-[13px] text-depot-muted"
            data-testid="depot-map-unpositioned"
          >
            {unpositionedSentence(unpositionedCount(depots))}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-4 self-start">
          <DepotMapPanel
            row={selected}
            rows={rows}
            onSelect={onSelect}
            vanished={vanished}
            onClear={clear}
          />
          <DepotMapLegend maxFleet={maxFleet} />
        </div>
      </div>
    </section>
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
        <KpiBand kpis={data.kpis} depots={data.depots} />
      </div>
      {rows.length === 0 ? (
        <EmptyState>
          The feed returned no units on this snapshot, so there is nothing to map, rank or list.
        </EmptyState>
      ) : (
        <>
          <MapSection rows={rows} selected={selected} onSelect={select} vanished={vanished} />
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
            <SelectionBar row={selected} />
            <DepotTable rows={rows} selectedId={selectedId} onSelect={select} />
          </div>
        </>
      )}
    </div>
  );
}

/** The no-data error: what happened and when, Retry, and the way back to Operations. */
function OverviewError({ onRetry }: { readonly onRetry: () => void }) {
  // Seen once, when the failure first rendered; a re-render must not move the time.
  const [at] = useState(() => formatClockTime(new Date()));
  return (
    <ErrorPanel message={loadErrorBody(at, null)} onRetry={onRetry}>
      <Link href={OPERATIONS_HREF} className="depot-link text-[13px]">
        Back to Operations
      </Link>
    </ErrorPanel>
  );
}

/**
 * The network overview: KPI band, depot map with its summary panel, ranked
 * depots, exceptions and the units table, all from the shell's single poll.
 * There is always something on screen: placeholders, an error with Retry, or
 * the last good data under a stale strip.
 */
export function NetworkOverview() {
  const { data, error, loading, refresh } = useDepotNetworkContext();

  if (!data) {
    if (loading || !error) return <OverviewLoading />;
    return <OverviewError onRetry={refresh} />;
  }

  return (
    <div data-testid="depot-overview">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <OverviewBody data={data} />
    </div>
  );
}

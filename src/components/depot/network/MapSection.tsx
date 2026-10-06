'use client';

import { useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { unpositionedSentence } from '@/lib/depot/network/mapWords';
import { unpositionedCount, type DepotRow } from '@/lib/depot/network/overviewModel';
import { DepotMap } from './DepotMap';
import { DepotMapLegend } from './DepotMapLegend';
import { DepotMapPanel } from './DepotMapPanel';
import type { DepotMapStatus } from './useDepotMap';
import { SelectionLine } from './SelectionBar';

const SECTION = 'animate-rise';

interface MapSectionProps {
  readonly rows: readonly DepotRow[];
  readonly selected: DepotRow | null;
  /** Null clears the selection. */
  readonly onSelect: (depotId: string | null) => void;
  readonly vanished: boolean;
}

export function MapSection({ rows, selected, onSelect, vanished }: MapSectionProps) {
  const depots = rows.map((row) => row.depot);
  const maxFleet = depots.reduce(
    (max, depot) => (depot.centroid ? Math.max(max, depot.fleet) : max),
    0,
  );
  const clear = (): void => onSelect(null);
  // The map, its caption and its legend stand or fall together: with no basemap the
  // words about circles and positioned buses would describe a picture that is not there.
  const [mapStatus, setMapStatus] = useState<DepotMapStatus>('loading');
  const mapAvailable = mapStatus !== 'error';

  return (
    <section aria-labelledby="depot-map-heading" className={SECTION}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-map-heading" className="depot-section-label scroll-mt-[var(--depot-anchor-mt)] !mb-0">
          Units map
        </h2>
        <ProvenanceBadge provenance="derived" />
        {mapAvailable ? (
          <p className="font-sans text-[13px] leading-snug text-depot-muted">
            Each unit is drawn at the median position of its buses, not at a surveyed yard, and it
            moves with them: a unit whose fleet is mostly out on routes can appear tens of
            kilometres from its yard.
          </p>
        ) : null}
      </div>
      <SelectionLine row={selected} onClear={clear} />
      <div className="depot-map-layout">
        <div className="min-w-0">
          <DepotMap
            rows={rows}
            maxFleet={maxFleet}
            selectedId={selected?.depot.id ?? null}
            onSelect={onSelect}
            onStatusChange={setMapStatus}
          />
          {mapAvailable ? (
            <p
              className="mt-2 font-sans text-[13px] text-depot-muted"
              data-testid="depot-map-unpositioned"
            >
              {unpositionedSentence(unpositionedCount(depots))}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4 self-start">
          <DepotMapPanel
            row={selected}
            rows={rows}
            onSelect={onSelect}
            vanished={vanished}
            onClear={clear}
          />
          {mapAvailable ? <DepotMapLegend maxFleet={maxFleet} /> : null}
        </div>
      </div>
    </section>
  );
}


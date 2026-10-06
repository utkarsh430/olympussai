'use client';

import { useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
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
  /** A short note on the right of the label. The index window is in the provenance line. */
  readonly windowNote?: string;
}

export function MapSection({ rows, selected, onSelect, vanished, windowNote }: MapSectionProps) {
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
      <SectionLabel id="depot-map-heading" label="Units map" note={windowNote} />
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
              {`Each unit is drawn at the median position of its buses, not at a surveyed yard. ${unpositionedSentence(unpositionedCount(depots))}`}
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


'use client';

import { useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { mapPositionNote } from '@/lib/depot/network/mapWords';
import { unpositionedCount, type DepotRow } from '@/lib/depot/network/overviewModel';
import { DepotMap } from './DepotMap';
import { DepotMapLegend } from './DepotMapLegend';
import { DepotMapPanel } from './DepotMapPanel';
import type { DepotMapStatus } from './useDepotMap';

const SECTION = 'animate-rise';

interface MapSectionProps {
  readonly rows: readonly DepotRow[];
  readonly selected: DepotRow | null;
  /** Null clears the selection. */
  readonly onSelect: (depotId: string | null) => void;
  readonly vanished: boolean;
  /** The units count on the map's label: "143 units, 119 of them operating depots". */
  readonly unitsNote?: string;
}

/**
 * The units map and, beside it from `xl`, the selected-unit panel with the legend and the
 * map's caption as one compact block under it. The map stretches to the row's height, so
 * both columns end on the same line whatever the panel holds. The selection is said once,
 * in the panel.
 */
export function MapSection({ rows, selected, onSelect, vanished, unitsNote }: MapSectionProps) {
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
      <SectionLabel id="depot-map-heading" label="Units map" note={unitsNote} />
      <div className="depot-map-layout">
        <div className="flex min-w-0 flex-col">
          <DepotMap
            rows={rows}
            maxFleet={maxFleet}
            selectedId={selected?.depot.id ?? null}
            onSelect={onSelect}
            onStatusChange={setMapStatus}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <DepotMapPanel
            row={selected}
            rows={rows}
            onSelect={onSelect}
            vanished={vanished}
            onClear={clear}
          />
          {mapAvailable ? (
            <>
              <DepotMapLegend maxFleet={maxFleet} />
              <p className="depot-caption" data-testid="depot-map-unpositioned">
                {mapPositionNote(unpositionedCount(depots))}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

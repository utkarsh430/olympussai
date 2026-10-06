'use client';

import type { RefObject } from 'react';
import {
  BASE_MAP_LOAD_TIMEOUT_MS,
  useBaseMap,
  type BaseMapStatus,
} from '@/components/depot/shell/useBaseMap';
import { getMapsLoader } from '@/lib/maps/loader';
import { zoomControlOptions } from '@/lib/depot/map/overviewMapView';

export type DepotMapStatus = BaseMapStatus;

/** A stalled script request never rejects; after this long it counts as a failure. */
export const MAP_LOAD_TIMEOUT_MS = BASE_MAP_LOAD_TIMEOUT_MS;

const STILL_AVAILABLE =
  'Every depot figure on this page is still available in the ranked lists and the table below.';

export interface DepotMapHandle {
  readonly mapRef: RefObject<google.maps.Map | null>;
  readonly status: DepotMapStatus;
  readonly errorMessage: string;
}

/** The overview map's own options: the zoom control top right, and fractional zoom. */
async function overviewMapOptions(): Promise<google.maps.MapOptions> {
  const { ControlPosition } = (await getMapsLoader().importLibrary(
    'core',
  )) as google.maps.CoreLibrary;
  return {
    // Top right: the frame's bottom can fall below the fold at 1440 x 900.
    zoomControlOptions: zoomControlOptions(ControlPosition),
    // fitBounds may then stop between whole zoom levels, so the units fill the frame.
    isFractionalZoomEnabled: true,
  };
}

const OPTIONS = {
  stillAvailable: STILL_AVAILABLE,
  timeoutText: 'The basemap could not be loaded.',
  extraOptions: overviewMapOptions,
} as const;

/**
 * Creates the depot map once inside `containerRef`, through the shared basemap hook (its
 * loader, timeout, refusal and clean-up rules); this map adds only its own options.
 */
export function useDepotMap(containerRef: RefObject<HTMLDivElement | null>): DepotMapHandle {
  const { mapRef, status, message } = useBaseMap(containerRef, OPTIONS);
  return { mapRef, status, errorMessage: message };
}

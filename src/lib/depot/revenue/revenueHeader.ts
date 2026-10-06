import type { DepotPageHeading } from '../fuel/fuelHeader';
import type { ProvenanceDescription } from '../provenanceLine';

/*
 * The revenue page's header, declared once so the page file's loading fallback and the
 * client page (which adds the dated modelled-day extension once the response arrives)
 * render the same title and sentence; the page file declares the provenance default. Every figure is MODELLED.
 */
export function revenueHeader(
  provenance: ProvenanceDescription,
  modelledDay?: string,
): DepotPageHeading {
  return {
    title: 'Revenue and ridership',
    description: 'Trips, boardings and revenue by route for the modelled operating day.',
    provenanceLine: modelledDay ? { ...provenance, modelledDay } : provenance,
  };
}

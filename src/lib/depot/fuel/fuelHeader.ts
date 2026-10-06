import type { ProvenanceDescription } from '../provenanceLine';

/*
 * The fuel page's header, declared once so the page file's loading fallback and the
 * client page (which adds the dated modelled-day extension once the response arrives)
 * render the same title and sentence; the page file declares the provenance default. Every figure is MODELLED.
 */

export interface DepotPageHeading {
  readonly title: string;
  readonly description: string;
  readonly provenanceLine: ProvenanceDescription;
}

export function fuelHeader(
  provenance: ProvenanceDescription,
  modelledDay?: string,
): DepotPageHeading {
  return {
    title: 'Fuel and cost',
    description: 'Fuel, distance and fuel cost, and the buses that use more fuel than their peers.',
    provenanceLine: modelledDay ? { ...provenance, modelledDay } : provenance,
  };
}

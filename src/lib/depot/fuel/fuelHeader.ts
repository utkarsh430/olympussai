import type { ProvenanceDescription } from '../provenanceLine';

/*
 * The fuel page's header, declared once so the page file's loading fallback and the
 * client page (which adds the dated modelled-day extension once the response arrives)
 * render the same title, sentence and provenance default. Every figure is MODELLED.
 */

export interface DepotPageHeading {
  readonly title: string;
  readonly description: string;
  readonly provenanceLine: ProvenanceDescription;
}

export function fuelHeader(modelledDay?: string): DepotPageHeading {
  return {
    title: 'Fuel and cost',
    description: 'Fuel, distance and fuel cost, and the buses that use more fuel than their peers.',
    provenanceLine: {
      default: 'modelled',
      replacedBy: 'fuel issue records and odometer readings',
      feedId: 'fuel',
      ...(modelledDay ? { modelledDay } : {}),
    },
  };
}

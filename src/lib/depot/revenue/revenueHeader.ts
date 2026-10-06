import type { DepotPageHeading } from '../fuel/fuelHeader';

/*
 * The revenue page's header, declared once so the page file's loading fallback and the
 * client page (which adds the dated modelled-day extension once the response arrives)
 * render the same title, sentence and provenance default. Every figure is MODELLED.
 */
export function revenueHeader(modelledDay?: string): DepotPageHeading {
  return {
    title: 'Revenue and ridership',
    description: 'Trips, boardings and revenue by route for the modelled operating day.',
    provenanceLine: {
      default: 'modelled',
      replacedBy: 'a ticketing feed and a route master',
      feedId: 'ticketing-ridership',
      ...(modelledDay ? { modelledDay } : {}),
    },
  };
}

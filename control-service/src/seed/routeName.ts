// UPSRTC route-name grammar: `<DEPOT>_<LINE>_<SERVICE CLASS>[_IN|_OUT]`, e.g.
// `BRH_949_ORD_OUT`, `CBG_142_JRT`, `MZP_1310_ORD_OUT`.
//
// Two upstream endpoints publish route names in this form —
// getScheduledBusInfo (`RouteName`) and getBusBetweenStops (`route_name`) — and
// both src/seed/harvest.ts and src/seed/odTimetable.ts have to read a direction
// out of one. These two functions live here rather than in either consumer so
// there is exactly ONE definition of what a trailing `_OUT` means: a second
// copy that treated, say, `_ORD` as a direction would split a line's departures
// into two half-populated buckets and halve its measured headway, silently.
//
// getStaticData publishes an EXPLICIT `line_direction` and does not need these
// (src/ingestion/upsrtc/staticData.ts#toDirectionCode). Where an explicit
// direction exists it always wins; a name suffix is what the OD feed leaves as
// the only signal.

/** `_ORD`, `_JRT`, `_VPL` etc. are service classes; only _IN/_OUT are directions. */
export function directionSuffix(routeName: string | null): 'IN' | 'OUT' | null {
  if (!routeName) return null;
  if (/_OUT$/i.test(routeName)) return 'OUT';
  if (/_IN$/i.test(routeName)) return 'IN';
  return null;
}

/** RouteName with any trailing _IN/_OUT removed. Service class is retained. */
export function stripDirectionSuffix(routeName: string): string {
  return routeName.replace(/_(IN|OUT)$/i, '');
}

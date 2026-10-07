import { formatPercent } from '../format';
import { DEFAULT_SPARE_RATIO } from '../optimise/config';
import { MAX_INTRA_DAY_KM } from '../optimise/hourlyReallocate';
import { MAINTENANCE_LOW_DEMAND_SHARE, MAINTENANCE_MIN_IDLE } from './networkProposals';
import { SERVICE_BANDS } from './networkHours';
import { bandLabel } from './serviceWording';

/*
 * The network "Service by the hour" page's words: its title, its states, and the closing
 * disclosure (definitions, the bands, the reallocation and the network kinds, the
 * assumptions and what real feeds would replace).
 */

export const NETWORK_SERVICE_TITLE = 'Service by the hour';
export const NETWORK_SERVICE_DESCRIPTION =
  'Every route’s buses against its need in each hour, the proposals for a band of the day and the buses that could move.';

export const NETWORK_SERVICE_TEXT = {
  loading: 'Loading the network’s day hour by hour',
  errorTitle: 'Network hours unavailable',
  empty: 'No route reports a route name in the feed now, so no route’s day can be shown.',
  filters: 'Choose a band and a depot',
  band: 'Band',
  depot: 'Depot',
  allDepots: 'All depots',
} as const;

const BANDS_SENTENCE = `The bands are ${SERVICE_BANDS.map((b) => `${b.label.toLowerCase()} ${bandLabel(b)}`).join(', ')}; the hours from midnight to 04:00 belong to none.`;

export const NETWORK_HOW_PRODUCED: readonly string[] = [
  'Each route’s day is the one its own hour-by-hour page shows: deployed buses observed by this server or, for the hours it did not observe, a modelled day of the buses the feed shows on the route; needed buses from modelled passenger demand; the gap is needed minus deployed, positive short.',
  `${BANDS_SENTENCE} A route is short in a band when its mean gap over the band’s hours rounds to one bus or more, and over when it rounds to minus one or less. Each route counts at the depot running most of its buses now.`,
  'The heat map shows every hour’s gap; a solid cell rests on what this server observed (or the feed now), a hatched cell on the modelled day. Routes are ordered by their largest gap in the band.',
  `The reallocation gives each depot’s spare buses in the band (what its over-served routes could release while keeping one bus on each, plus the buses standing in its yard as observed, else those its modelled day leaves without a duty) to the short routes, at the least empty driving: a move within the depot that runs the route costs nothing; a move from another depot costs the empty kilometres there and back, from the route profile where one is loaded, else between the two depots, and is not offered beyond ${MAX_INTRA_DAY_KM} km.`,
  `The network’s own proposals: a reserve of ${formatPercent(DEFAULT_SPARE_RATIO)} of each depot’s need in the band; a maintenance window where a depot has ${MAINTENANCE_MIN_IDLE} or more idle buses in a band outside the peaks while its need is at most ${formatPercent(MAINTENANCE_LOW_DEMAND_SHARE)} of its peak; departures that could move from an over-served hour to the next short hour on the same route; and corridors, the routes sharing the same two terminals either way in their loaded profiles, short or over together.`,
  'Assumptions: passenger demand is modelled until ticketing is connected, so the proposals say when buses are short more reliably than how many. Every figure here is a recommendation: nothing is dispatched or reassigned, and no person is named or scored.',
];

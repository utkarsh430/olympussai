import { DEI_COMPONENTS, MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import { SCORE_WINDOW_MIN } from '@/lib/depot/score/window';
import { DEFAULT_HISTORY_DAYS } from '@/lib/depot/sim/config';
import { DARK_HEADER_TITLE } from './unitsTable';

/*
 * The text of each network page's closing disclosure, "How these figures are produced".
 * Everything here was said above the figures before the design wave; it moved, it was
 * not dropped. Numbers come from the configuration, never retyped.
 */

const WEIGHT_PERCENT = 100;

function indexDefinition(): string {
  const parts = DEI_COMPONENTS.map((c) => `${c.label.toLowerCase()} ${Math.round(c.weight * WEIGHT_PERCENT)}%`);
  return (
    'The efficiency index weighs five rates, each compared with the median of depots of ' +
    `similar fleet size (the peer group): ${parts.join(', ')}. A typical peer scores 50.`
  );
}

const WINDOW =
  `Each rate is summed over the last ${SCORE_WINDOW_MIN} minutes of the feed, so a single poll ` +
  'does not reorder the depots; while the window fills after a restart it says since when. ' +
  'Bus counts are as of the feed time in the provenance line.';

const RANKED =
  `A depot is ranked once it has at least ${MIN_FLEET_FOR_RANK} buses; smaller depots and the ` +
  'other units are listed as not ranked.';

export const LEAGUE_HOW_PRODUCED: readonly string[] = [
  indexDefinition(),
  WINDOW,
  RANKED,
  `The index trend column is MODELLED: a generated ${DEFAULT_HISTORY_DAYS}-day history that ends on the live ` +
    'value, with its direction over four weeks. It is not measured.',
];

export const OVERVIEW_HOW_PRODUCED: readonly string[] = [
  'A unit is any home depot in the feed. An operating depot is a unit of kind depot; ' +
    'everything else (enforcement squads, hired and electric fleets, the unassigned bucket) ' +
    'is an other unit.',
  'Each unit is drawn at the median position of its buses, not at a surveyed yard, and it ' +
    'moves with them: a unit whose fleet is mostly out on routes can appear tens of ' +
    'kilometres from its yard.',
  'Every bus is in one state, from its last report, in the same words as each depot\'s ' +
    'cockpit: on road (in service or not), standing, dark and off road. ' +
    `${DARK_HEADER_TITLE}. Off road is what the feed flags as under maintenance.`,
  indexDefinition(),
  WINDOW,
  'The week trend beside the figures is MODELLED and measures shares, not the counts above ' +
    'it: on-road share is buses in service or on road out of buses not off the road; dark ' +
    'share is the inferred share of buses that have stopped reporting.',
];

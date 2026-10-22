/**
 * The one vocabulary Depot Intelligence OS uses to say what kind of figure the person is
 * looking at. A figure is observed from the GPS feed, worked out from it, projected
 * forward, estimated, part of a scenario record set, or a proposal awaiting a person.
 * The words are drawn as small tags; the longer explanation sits in the tag's tooltip
 * and on the Integration Health page, never as a paragraph on the screen.
 */
export type DataStatus = 'live' | 'derived' | 'forecast' | 'estimate' | 'scenario' | 'proposed';

export const DATA_STATUS_LABEL: Readonly<Record<DataStatus, string>> = {
  live: 'LIVE',
  derived: 'DERIVED',
  forecast: 'FORECAST',
  estimate: 'ESTIMATE',
  scenario: 'SCENARIO',
  proposed: 'PROPOSED',
};

export const DATA_STATUS_TITLE: Readonly<Record<DataStatus, string>> = {
  live: 'Observed in the UPSRTC GPS feed on the latest snapshot.',
  derived: 'Worked out from the GPS feed on the latest snapshot.',
  forecast: 'Projected forward from history; a range, not a measurement.',
  estimate: 'Estimated from planning figures until the source system is connected.',
  scenario:
    'Scenario records standing in for a source system not yet connected (fuel, maintenance, crew, ticketing). Consistent across every workspace.',
  proposed: 'A recommendation awaiting a person. Nothing is dispatched, moved or charged by the system.',
};

/** The module-wide indicator in the top bar. */
export const MODULE_DATA_LABEL = 'LIVE GPS + SCENARIO';
export const MODULE_DATA_TITLE =
  'Fleet positions and states come from the UPSRTC GPS feed. Schedules, crew, maintenance, fuel and ticketing are scenario records until those systems are connected. See Integration Health.';

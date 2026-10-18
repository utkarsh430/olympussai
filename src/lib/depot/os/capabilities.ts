import type { DataStatus } from './dataStatus';

/**
 * The AI capabilities of Depot Intelligence OS and the view each one runs in. The index
 * is how a person finds them; each entry names what it computes, so a capability is a
 * calculation with a place to see it, never a label.
 */
export interface Capability {
  readonly id: string;
  readonly name: string;
  /** What it computes, in one line. */
  readonly does: string;
  /** The workspace view key where it runs. */
  readonly view: string;
  readonly basis: DataStatus;
}

export const CAPABILITIES: readonly Capability[] = [
  { id: 'network-health', name: 'Network Health Intelligence', does: 'Classifies every bus from the GPS feed and rolls the fleet up by depot and region.', view: 'mission', basis: 'live' },
  { id: 'predictive-alerts', name: 'Predictive Operational Alerts', does: 'Raises shortages, maintenance risk and fuel excess before they bite.', view: 'mission', basis: 'derived' },
  { id: 'prioritisation', name: 'AI Decision Prioritisation', does: 'Ranks every decision by severity thresholds and weight into one queue.', view: 'decisions', basis: 'derived' },
  { id: 'demand', name: 'Hourly Demand Forecasting', does: 'Projects passengers and buses needed per route hour.', view: 'demand', basis: 'forecast' },
  { id: 'route-redistribution', name: 'Route-Level Bus Redistribution', does: 'Moves buses between routes hour by hour to close gaps.', view: 'demand', basis: 'proposed' },
  { id: 'depot-redistribution', name: 'Inter-Depot Fleet Redistribution', does: 'Min-cost flow of surplus buses to depots short at peak.', view: 'rebalance', basis: 'proposed' },
  { id: 'scheduling', name: 'AI Scheduling Optimisation', does: 'Covers every hour’s need with the fewest buses and crew slots.', view: 'scheduler', basis: 'proposed' },
  { id: 'bunching', name: 'Bus Bunching Prediction', does: 'Finds buses on one route closer together than their headway allows.', view: 'headways', basis: 'derived' },
  { id: 'readiness', name: 'Departure Readiness Intelligence', does: 'Checks bus, crew and maintenance for each upcoming departure.', view: 'readiness', basis: 'derived' },
  { id: 'crew', name: 'AI Crew Allocation', does: 'Covers each shift with available driver and conductor slots.', view: 'crew', basis: 'scenario' },
  { id: 'yard', name: 'Smart Yard Planning', does: 'Locates buses in and away from the yard and orders the turn-out.', view: 'yard', basis: 'derived' },
  { id: 'availability-forecast', name: 'Fleet Availability Forecasting', does: 'Projects available buses with a range from history.', view: 'forecasts', basis: 'forecast' },
  { id: 'predictive-maintenance', name: 'Predictive Maintenance', does: 'Service-due prediction, recurring faults and bay priority.', view: 'health', basis: 'estimate' },
  { id: 'breakdown-risk', name: 'Breakdown Risk Intelligence', does: 'A points index per bus with every factor listed.', view: 'health', basis: 'estimate' },
  { id: 'incident-recovery', name: 'AI Incident Recovery', does: 'Detects likely breakdowns and ranks replacements by passengers moving soonest.', view: 'incidents', basis: 'derived' },
  { id: 'propagation', name: 'Disruption Propagation Analysis', does: 'Traces one lost bus through its later duties and the gaps it leaves.', view: 'disruption', basis: 'derived' },
  { id: 'fuel-anomaly', name: 'Fuel Consumption Anomaly Detection', does: 'Flags journeys far above the bus’s own median economy.', view: 'fuel-audit', basis: 'scenario' },
  { id: 'efficiency', name: 'Vehicle Efficiency Benchmarking', does: 'Compares each bus’s km/L with its class and depot peers.', view: 'fuel-audit', basis: 'scenario' },
  { id: 'revenue-anomaly', name: 'Revenue Anomaly Intelligence', does: 'Compares ticketed passengers with an independent boarding count where one exists.', view: 'revenue', basis: 'scenario' },
  { id: 'cost', name: 'AI Cost Optimisation', does: 'Quantifies avoidable fuel, dead running and idle buses.', view: 'cost', basis: 'estimate' },
  { id: 'performance-forecast', name: 'Depot Performance Forecasting', does: 'Projects each depot’s measures forward with a range.', view: 'forecasts', basis: 'forecast' },
  { id: 'scenarios', name: 'Scenario Simulation', does: 'Recomputes shortages, transfers and cost under changed demand and fleet.', view: 'simulation', basis: 'scenario' },
  { id: 'twin', name: 'Digital Twin Intelligence', does: 'A schematic of depots, flows and pressure that moves with the snapshot.', view: 'twin', basis: 'derived' },
  { id: 'copilot', name: 'Contextual AI Copilot', does: 'Answers from the records on screen and opens the view behind each answer.', view: 'ask', basis: 'derived' },
  { id: 'briefing', name: 'Automated Operational Briefings', does: 'Writes the shift briefing from the decision queue and the figures behind it.', view: 'decisions', basis: 'derived' },
  { id: 'capacity', name: 'Network Capacity Planning', does: 'Before/after coverage for combined route and depot redistribution.', view: 'optimisation', basis: 'proposed' },
];

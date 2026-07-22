import { buildBunchingScenario, type BunchingScenario } from '@/lib/demo-scenarios/bunchingScenario';
import { buildTrafficScenario, type TrafficScenario } from '@/lib/demo-scenarios/trafficScenario';
import { buildBreakdownScenario, type BreakdownScenario } from '@/lib/demo-scenarios/breakdownScenario';
import { buildDemandScenario, type DemandScenario } from '@/lib/demo-scenarios/demandScenario';
import type { ScenarioContext, ScenarioKind } from '@/lib/demo-scenarios/types';

export type AnyScenario = BunchingScenario | TrafficScenario | BreakdownScenario | DemandScenario;

/**
 * Single entry point for building a predictive scenario.
 * Deterministic: same bus + same overrides always yields the same output.
 */
export function buildScenario(
  kind: Exclude<ScenarioKind, 'communication'>,
  context: ScenarioContext,
): AnyScenario {
  switch (kind) {
    case 'bunching':
      return buildBunchingScenario(context);
    case 'traffic':
      return buildTrafficScenario(context);
    case 'breakdown':
      return buildBreakdownScenario(context);
    case 'demand':
      return buildDemandScenario(context);
  }
}

export const SCENARIO_TITLES: Record<ScenarioKind, string> = {
  bunching: 'Bus Bunching',
  traffic: 'Traffic Jam Ahead',
  breakdown: 'Breakdown Response',
  demand: 'Peak-Hour Demand',
  communication: 'Driver Communication',
};

export const SCENARIO_FULL_LABELS: Record<ScenarioKind, string> = {
  bunching: 'BUNCHING OPTIMIZATION',
  traffic: 'CORRIDOR TRAFFIC INTELLIGENCE',
  breakdown: 'BREAKDOWN RESPONSE COORDINATION',
  demand: 'DEMAND AND FLEET REDISTRIBUTION',
  communication: 'DRIVER COMMUNICATION',
};

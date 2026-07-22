import { buildScenario } from '@/lib/simulation/scenarioEngine';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import type { AlertSeverity, ScenarioKind } from '@/lib/demo-scenarios/types';
import type { CanonicalLiveBus } from '@/models/canonical';

/**
 * Predictive alert stream.
 *
 * Alerts are anchored to a real vehicle: real registration, real depot, real
 * route and real GPS position, all taken from the live feed. The predicted
 * condition itself comes from the local scenario models, so the alert panel is
 * labelled PREDICTIVE rather than presented as a confirmed operational event.
 */

export type AlertKind = Exclude<ScenarioKind, 'communication'>;

/**
 * The ongoing stream alternates headway and corridor conditions only.
 *
 * Vehicle faults are deliberately rare: exactly one is seeded at startup and
 * none are raised afterwards, so a critical incident stays exceptional rather
 * than becoming background noise. Demand is not streamed — it is reviewed
 * network-wide from the Fleet Distribution view.
 */
export const ALERT_ROTATION: AlertKind[] = ['bunching', 'traffic'];

/** Raised once during seeding, never by the ongoing stream. */
export const SEEDED_INCIDENT_KIND: AlertKind = 'breakdown';

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  bunching: 'Bunching',
  traffic: 'Traffic',
  breakdown: 'Vehicle',
  demand: 'Demand',
};

export interface FleetAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  severityText: string;
  /** Real UPSRTC identifiers, straight from the live feed. */
  busId: string;
  registrationNumber: string;
  depotName: string | null;
  routeName: string | null;
  latitude: number;
  longitude: number;
  title: string;
  summary: string;
  confidencePercent: number;
  raisedAt: string;
  acknowledged: boolean;
}

/** Compact headline per kind — the alert list needs a short, scannable line. */
function alertTitle(kind: AlertKind, bus: CanonicalLiveBus): string {
  switch (kind) {
    case 'bunching':
      return 'Bus bunching detected';
    case 'traffic':
      return 'Traffic congestion detected';
    case 'breakdown':
      return 'Vehicle fault signature detected';
    case 'demand':
      return `Demand imbalance on ${bus.routeName ?? 'corridor'}`;
  }
}

/**
 * Prefer vehicles that make a convincing, information-rich alert: a recent GPS
 * fix and a known route and depot. Falls back progressively so the stream never
 * stalls on a sparse feed.
 */
export function selectAlertCandidate(
  buses: CanonicalLiveBus[],
  exclude: Set<string>,
  seed: string,
): CanonicalLiveBus | null {
  if (buses.length === 0) return null;

  const tiers = [
    buses.filter((b) => b.dataQuality === 'good' && b.routeName && b.depotName && !exclude.has(b.id)),
    buses.filter((b) => b.routeName && !exclude.has(b.id)),
    buses.filter((b) => !exclude.has(b.id)),
    buses,
  ];

  const pool = tiers.find((tier) => tier.length > 0);
  if (!pool || pool.length === 0) return null;

  const random = new SeededRandom(seed);
  return pool[random.int(0, pool.length - 1)] ?? null;
}

/** Build one alert for a given kind, anchored to a real vehicle. */
export function buildAlert(
  kind: AlertKind,
  bus: CanonicalLiveBus,
  raisedAt: Date = new Date(),
): FleetAlert {
  const scenario = buildScenario(kind, { bus, schedule: null });

  return {
    id: `${kind}-${bus.id}-${raisedAt.getTime()}`,
    kind,
    severity: scenario.severity,
    severityText: scenario.severityText,
    busId: bus.id,
    registrationNumber: bus.registrationNumber,
    depotName: bus.depotName,
    routeName: bus.routeName,
    latitude: bus.latitude,
    longitude: bus.longitude,
    title: alertTitle(kind, bus),
    summary: scenario.headline,
    confidencePercent: scenario.confidencePercent,
    raisedAt: raisedAt.toISOString(),
    acknowledged: false,
  };
}

/**
 * Seed the panel so the control room never looks empty on arrival.
 * Timestamps are staggered backwards so the feed reads as already established.
 */
export function buildInitialAlerts(buses: CanonicalLiveBus[], count = 5): FleetAlert[] {
  const alerts: FleetAlert[] = [];
  const used = new Set<string>();
  const now = Date.now();

  // Exactly one vehicle fault, placed mid-board so it does not read as the
  // newest event; everything else alternates headway and corridor.
  const incidentSlot = Math.min(1, count - 1);
  // Counted separately from the loop index, otherwise the incident slot eats a
  // turn and the remaining kinds stop alternating evenly.
  let rotationStep = 0;

  for (let index = 0; index < count; index += 1) {
    const isIncident = index === incidentSlot;
    const kind = isIncident
      ? SEEDED_INCIDENT_KIND
      : (ALERT_ROTATION[rotationStep++ % ALERT_ROTATION.length] as AlertKind);

    const bus = selectAlertCandidate(buses, used, `seed-${index}-${kind}`);
    if (!bus) break;
    used.add(bus.id);

    // Oldest first in generation order, then reversed so newest sits on top.
    const raisedAt = new Date(now - (count - index) * 74_000);
    alerts.push(buildAlert(kind, bus, raisedAt));
  }

  return alerts.reverse();
}

/**
 * Next alert in the ongoing stream, avoiding vehicles already on the board.
 * Only headway and corridor conditions are raised here.
 */
export function buildNextAlert(
  buses: CanonicalLiveBus[],
  rotationIndex: number,
  activeBusIds: Set<string>,
): FleetAlert | null {
  const kind = ALERT_ROTATION[rotationIndex % ALERT_ROTATION.length] as AlertKind;
  const bus = selectAlertCandidate(buses, activeBusIds, `stream-${rotationIndex}-${Date.now()}`);
  if (!bus) return null;
  return buildAlert(kind, bus, new Date());
}

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  advisory: 2,
  info: 3,
};

import type { DepotDistributionResponse, DepotNetworkResponse } from '../../api';
import { depotHref, incidentBusHref } from '../../depotNav';
import { formatCount } from '../../format';
import type { IncidentRollupRow, IncidentRollupResponse } from '../../incident/api';
import { kindText, SIGNAL_TEXT } from '../../incident/incidentWording';
import { REBALANCE_PATH } from '../../nav';
import type { DepotSummary } from '../../types';
import { DECISIONS_PATH, FUEL_AUDIT_PATH, RELIABILITY_PATH, SIMULATION_PATH } from '../workspaces';
import type { FuelAudit } from './fuelAudit';
import { SEVERITY_RANK, type Decision, type DecisionOption, type Severity } from './types';
import { RISK_BANDS, type VehicleHealth } from './vehicleHealth';

/**
 * The AI decision queue. Each generator reads one source and turns what it finds into
 * decisions of the same seven-part shape; every figure a decision states is read from
 * the record it cites, so the queue, the decision panel and the copilot never disagree.
 * Severity follows fixed thresholds written below, never a model's guess.
 */

export interface DecisionInput {
  readonly network: DepotNetworkResponse;
  readonly distribution: DepotDistributionResponse | null;
  readonly incidents: IncidentRollupResponse | null;
  readonly health: readonly VehicleHealth[] | null;
  readonly fuel: FuelAudit | null;
  /** The depots in scope (a region or one depot); null for the whole network. */
  readonly scope: ReadonlySet<string> | null;
}

const MORNING_PEAK = 'Morning peak · 06:00–10:00';
const APPROVAL_TRANSFER =
  'The depot manager and the regional office approve any transfer; nothing is dispatched by the system.';
const APPROVAL_MAINTENANCE = 'The depot workshop in-charge decides on inspection and withdrawal.';
const APPROVAL_FUEL =
  'The depot accounts officer assigns verification; no finding is recorded against anyone by the system.';
const APPROVAL_INCIDENT = 'The depot controller confirms the breakdown and sends the replacement.';

/** Thresholds behind each severity. */
export const THRESHOLDS = {
  shortageCritical: 0.12,
  shortageHigh: 0.06,
  darkHigh: 0.4,
  darkMedium: 0.25,
  darkMinFleet: 20,
  fuelHighRupees: 25_000,
  fuelMediumRupees: 8_000,
  maxPerCategory: 8,
} as const;

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const rupees = (n: number): string => `₹${formatCount(Math.round(n))}`;

function inScope(scope: ReadonlySet<string> | null, depotId: string | null): boolean {
  return scope === null || (depotId !== null && scope.has(depotId));
}

function shortageDecisions(input: DecisionInput, byId: ReadonlyMap<string, DepotSummary>): Decision[] {
  const dist = input.distribution;
  if (!dist) return [];
  const names = new Map(dist.balances.map((b) => [b.depotId, b.depotName]));
  return dist.balances
    .filter((b) => b.balance < 0 && b.kind === 'depot' && inScope(input.scope, b.depotId))
    .map((b): Decision => {
      const deficit = -b.balance;
      const share = b.required > 0 ? deficit / b.required : 0;
      const severity: Severity =
        share >= THRESHOLDS.shortageCritical ? 'critical' : share >= THRESHOLDS.shortageHigh ? 'high' : 'medium';
      const incoming = dist.plan.transfers.filter((t) => t.toDepotId === b.depotId);
      const moved = incoming.reduce((sum, t) => sum + t.buses, 0);
      const busKm = incoming.reduce((sum, t) => sum + t.busKm, 0);
      const donors = incoming.map((t) => `${names.get(t.fromDepotId) ?? t.fromDepotId} (${t.buses}, ${Math.round(t.distanceKm)} km)`);
      const uncovered = dist.plan.uncovered.find((u) => u.depotId === b.depotId);
      const fastTrack: DecisionOption = {
        title: `Fast-track the quickest of ${formatCount(b.offRoad)} off-road buses`,
        detail: 'Ask the workshop which off-road buses can be released before the peak.',
        impact: `Each bus released covers one peak duty (up to ${formatCount(Math.min(b.offRoad, deficit))}).`,
        tradeOff: 'Deferred repairs return; only buses without a safety defect qualify.',
      };
      const thin: DecisionOption = {
        title: 'Thin the lowest-demand peak trips',
        detail: 'Stretch headways on the depot’s quietest routes during the peak to free buses for the busiest ones.',
        impact: `Frees up to ${formatCount(deficit)} buses without moving any between depots.`,
        tradeOff: 'Longer waits on the routes thinned; check Hourly Demand before choosing them.',
      };
      const transfer: DecisionOption | null =
        moved > 0
          ? {
              title: `Transfer ${formatCount(moved)} bus${moved === 1 ? '' : 'es'} from ${incoming.length} depot${incoming.length === 1 ? '' : 's'}`,
              detail: `From ${donors.join(', ')}.`,
              impact: `Covers ${formatCount(moved)} of ${formatCount(deficit)} (${pct(moved / deficit)}) of the peak shortage.`,
              tradeOff: `${formatCount(Math.round(busKm))} empty bus-km of repositioning; each donor keeps its spare target.`,
            }
          : null;
      const recommendation = transfer ?? (b.offRoad > 0 ? fastTrack : thin);
      const alternatives = [transfer, fastTrack, thin].filter(
        (o): o is DecisionOption => o !== null && o !== recommendation && (o !== fastTrack || b.offRoad > 0),
      );
      const depot = byId.get(b.depotId);
      return {
        id: `shortage:${b.depotId}`,
        category: 'shortage',
        severity,
        weight: deficit,
        title: `${b.depotName}: ${formatCount(deficit)} bus${deficit === 1 ? '' : 'es'} short for the morning peak`,
        entity: { kind: 'depot', id: b.depotId, label: b.depotName },
        depotId: b.depotId,
        timing: MORNING_PEAK,
        detected: `The peak needs ${formatCount(b.peakRequirement)} buses plus ${formatCount(b.spareTarget)} spare (${formatCount(b.required)}); ${formatCount(b.available)} are available after ${formatCount(b.offRoad)} off the road.`,
        whyItMatters: `Without action about ${formatCount(deficit)} peak duties start without a bus or with no spare to cover a failure${depot ? `, on a fleet of ${formatCount(depot.fleet)}` : ''}.`,
        evidence: [
          { label: 'Fleet', value: formatCount(b.fleet), status: 'live' },
          { label: 'Off the road', value: formatCount(b.offRoad), status: 'live' },
          { label: 'Available', value: formatCount(b.available), status: 'derived' },
          { label: 'Peak requirement', value: formatCount(b.peakRequirement), status: 'estimate' },
          { label: 'Spare target', value: formatCount(b.spareTarget), status: 'estimate' },
          { label: 'Shortage', value: `${formatCount(deficit)} (${pct(share)} of need)`, status: 'derived' },
        ],
        recommendation,
        alternatives,
        impact:
          moved > 0
            ? `${formatCount(moved)} of ${formatCount(deficit)} buses covered${uncovered ? `; ${formatCount(uncovered.buses)} remain with no surplus in range` : ''}.`
            : `No depot within range has surplus buses; ${recommendation.impact}`,
        approval: APPROVAL_TRANSFER,
        links: [
          { label: 'Between Depots', href: REBALANCE_PATH },
          { label: 'Depot Mission Control', href: depotHref(b.depotId) },
          { label: 'Scenario Studio', href: SIMULATION_PATH },
        ],
        basis: 'estimate',
      };
    });
}

function redistributionDecision(input: DecisionInput): Decision[] {
  const dist = input.distribution;
  if (!dist || dist.plan.transfers.length === 0) return [];
  const transfers = dist.plan.transfers.filter((t) => inScope(input.scope, t.toDepotId) || inScope(input.scope, t.fromDepotId));
  if (transfers.length === 0) return [];
  const moved = transfers.reduce((s, t) => s + t.buses, 0);
  const busKm = transfers.reduce((s, t) => s + t.busKm, 0);
  const { before, after } = dist.plan;
  return [
    {
      id: 'redistribution:network',
      category: 'redistribution',
      severity: moved >= 10 ? 'high' : 'medium',
      weight: moved,
      title: `Redistribution plan: ${formatCount(transfers.length)} transfers move ${formatCount(moved)} buses to depots short at peak`,
      entity: { kind: 'network', id: 'network', label: 'UPSRTC network' },
      depotId: null,
      timing: `${MORNING_PEAK} · move the evening before`,
      detected: `${formatCount(before.depotsInDeficit)} depots are short by ${formatCount(before.totalDeficit)} buses in all while ${formatCount(before.depotsInSurplus)} hold ${formatCount(before.totalSurplus)} above their need.`,
      whyItMatters: 'Surplus buses standing in one depot while another runs short is the cheapest shortage to close.',
      evidence: [
        { label: 'Depots short (before)', value: formatCount(before.depotsInDeficit), status: 'derived' },
        { label: 'Total shortage (before)', value: formatCount(before.totalDeficit), status: 'derived' },
        { label: 'Depots with surplus', value: formatCount(before.depotsInSurplus), status: 'derived' },
        { label: 'Buses moved', value: formatCount(moved), status: 'proposed' },
        { label: 'Empty repositioning', value: `${formatCount(Math.round(busKm))} bus-km`, status: 'proposed' },
      ],
      recommendation: {
        title: `Review and approve ${formatCount(transfers.length)} transfers`,
        detail: 'Each transfer is the shortest move that closes a deficit without taking a donor below its spare target.',
        impact: `Shortage falls from ${formatCount(before.totalDeficit)} to ${formatCount(after.totalDeficit)}; depots short from ${formatCount(before.depotsInDeficit)} to ${formatCount(after.depotsInDeficit)}.`,
        tradeOff: `${formatCount(Math.round(busKm))} empty bus-km and a crew to drive each move.`,
      },
      alternatives: [
        {
          title: 'Run it in the Scenario Studio with a shorter transfer limit',
          detail: 'Fewer, shorter moves; more deficit left open.',
          impact: 'Less dead running at the cost of coverage.',
          tradeOff: 'Some depots stay short.',
        },
      ],
      impact: `${formatCount(dist.plan.coveredDeficit)} of ${formatCount(before.totalDeficit)} buses of shortage covered.`,
      approval: APPROVAL_TRANSFER,
      links: [
        { label: 'Between Depots', href: REBALANCE_PATH },
        { label: 'Scenario Studio', href: SIMULATION_PATH },
      ],
      basis: 'proposed',
    },
  ];
}

/** A breakdown is critical only on the device's own emergency flag with high confidence. */
function incidentSeverity(r: IncidentRollupRow): Severity {
  if (r.confidence === 'high' && r.signals.includes('emergency_flag')) return 'critical';
  if (r.confidence === 'high') return 'high';
  return r.confidence === 'medium' ? 'medium' : 'low';
}

function singleIncident(r: IncidentRollupRow): Decision {
  const aboard = r.passengersAboard;
  const ready = r.planState === 'ready' && r.recommendedKind !== null;
  const replacement = ready ? kindText(r.recommendedKind!, r.recommendedDepotName ?? r.depotName) : null;
  return {
    id: `incident:${r.registrationNumber}`,
    category: 'incident',
    severity: incidentSeverity(r),
    weight: aboard ?? 0,
    title: `${r.registrationNumber} may have broken down${r.routeName ? ` on ${r.routeName}` : ''}`,
    entity: { kind: 'vehicle', id: r.registrationNumber, label: r.registrationNumber },
    depotId: r.depotId,
    timing: 'Now',
    detected: `${r.signals.map((s) => SIGNAL_TEXT[s]).join('; ')}.`,
    whyItMatters:
      aboard !== null
        ? `About ${formatCount(aboard)} passengers are waiting aboard and the bus's later duties are at risk.`
        : "The bus's later duties are at risk until a replacement is found.",
    evidence: [
      { label: 'Signals', value: r.signals.map((s) => SIGNAL_TEXT[s]).join(', '), status: 'live' },
      { label: 'Confidence', value: r.confidence, status: 'derived' },
      { label: 'Passengers aboard', value: aboard === null ? 'Unknown' : formatCount(aboard), status: 'estimate' },
      {
        label: 'Replacement arrival',
        value: r.arrivalMinutes === null ? 'Not planned' : `${formatCount(r.arrivalMinutes)} min`,
        status: 'estimate',
      },
    ],
    recommendation: ready
      ? {
          title: replacement!,
          detail: 'Ranked by passengers moving soonest, then the fewest empty kilometres, then the least knock-on.',
          impact: r.arrivalMinutes === null ? 'Passengers moving once it arrives.' : `Passengers moving in about ${formatCount(r.arrivalMinutes)} minutes.`,
          tradeOff: 'The replacement leaves its own duty or spare position; see the knock-on in Disruption Propagation.',
        }
      : {
          title: 'Plan a replacement',
          detail: 'The plan is still being worked out for this depot.',
          impact: 'Open the incident for the ranked candidates.',
          tradeOff: 'None until a candidate is chosen.',
        },
    alternatives: [
      {
        title: 'Confirm by phone before sending anything',
        detail: 'A feed status can lag the road; the crew can confirm in a minute.',
        impact: 'No empty running if the bus is fine.',
        tradeOff: 'Passengers wait while it is confirmed.',
      },
      {
        title: 'Wait for the next scheduled bus',
        detail: 'Passengers transfer to the next service on the route.',
        impact: 'No empty running; passengers wait one headway.',
        tradeOff: 'Seats on the next bus may not suffice.',
      },
    ],
    impact: ready ? `Recovery planned with ${replacement!.toLowerCase()}.` : 'Recovery not yet planned.',
    approval: APPROVAL_INCIDENT,
    links: [
      { label: 'Incident Response', href: incidentBusHref(r.depotId, r.registrationNumber) },
      { label: 'Disruption Propagation', href: `${depotHref(r.depotId)}/disruption?bus=${encodeURIComponent(r.registrationNumber)}` },
    ],
    basis: 'derived',
  };
}

function depotIncidents(depotId: string, rows: readonly IncidentRollupRow[]): Decision {
  const sorted = [...rows].sort((a, b) => SEVERITY_RANK[incidentSeverity(a)] - SEVERITY_RANK[incidentSeverity(b)] || (b.passengersAboard ?? 0) - (a.passengersAboard ?? 0));
  const worst = incidentSeverity(sorted[0]!);
  const name = sorted[0]!.depotName;
  const aboard = rows.reduce((s, r) => s + (r.passengersAboard ?? 0), 0);
  const planned = rows.filter((r) => r.planState === 'ready' && r.recommendedKind !== null).length;
  const high = rows.filter((r) => r.confidence === 'high').length;
  const flags = rows.filter((r) => r.signals.includes('emergency_flag')).length;
  return {
    id: `incidents:${depotId}`,
    category: 'incident',
    severity: worst,
    weight: aboard,
    title: `${name}: ${formatCount(rows.length)} buses may have broken down on the road`,
    entity: { kind: 'depot', id: depotId, label: name },
    depotId,
    timing: 'Now',
    detected: `${formatCount(high)} with high confidence${flags > 0 ? `, ${formatCount(flags)} with the device's emergency flag raised` : ''}: ${sorted
      .slice(0, 3)
      .map((r) => r.registrationNumber)
      .join(', ')}${rows.length > 3 ? ' and more' : ''}.`,
    whyItMatters: `About ${formatCount(aboard)} passengers may be waiting aboard, and each bus's later duties are at risk.`,
    evidence: [
      { label: 'Suspected breakdowns', value: formatCount(rows.length), status: 'derived' },
      { label: 'High confidence', value: formatCount(high), status: 'derived' },
      { label: 'Emergency flags', value: formatCount(flags), status: 'live' },
      { label: 'Passengers aboard', value: formatCount(aboard), status: 'estimate' },
      { label: 'Replacements planned', value: `${formatCount(planned)} of ${formatCount(rows.length)}`, status: 'proposed' },
    ],
    recommendation: {
      title: 'Confirm the high-confidence buses and send the planned replacements',
      detail: 'Start with an emergency flag, then the most passengers aboard.',
      impact: `${formatCount(planned)} replacements are ranked and ready to send.`,
      tradeOff: 'Each replacement leaves its own spare position or duty.',
    },
    alternatives: [
      {
        title: 'Confirm by phone before sending anything',
        detail: 'A feed status can lag the road.',
        impact: 'No empty running for a bus that is fine.',
        tradeOff: 'Passengers wait while each is confirmed.',
      },
    ],
    impact: `${formatCount(planned)} of ${formatCount(rows.length)} recoveries planned.`,
    approval: APPROVAL_INCIDENT,
    links: [
      { label: 'Incident Response', href: `${depotHref(depotId)}/incidents` },
      { label: 'Disruption Propagation', href: `${depotHref(depotId)}/disruption` },
    ],
    basis: 'derived',
  };
}

function incidentDecisions(input: DecisionInput): Decision[] {
  const groups = new Map<string, IncidentRollupRow[]>();
  for (const r of input.incidents?.rows ?? []) {
    if (!inScope(input.scope, r.depotId)) continue;
    const held = groups.get(r.depotId);
    if (held) held.push(r);
    else groups.set(r.depotId, [r]);
  }
  const perDepot = [...groups.entries()].map(([depotId, rows]) => (rows.length === 1 ? singleIncident(rows[0]!) : depotIncidents(depotId, rows)));
  // In one depot's scope, its buses are listed one by one.
  if (input.scope !== null && input.scope.size === 1) {
    return (groups.values().next().value ?? []).map(singleIncident);
  }
  return perDepot
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.weight - a.weight)
    .slice(0, THRESHOLDS.maxPerCategory);
}

function maintenanceDecisions(input: DecisionInput, byId: ReadonlyMap<string, DepotSummary>): Decision[] {
  if (!input.health) return [];
  const groups = new Map<string, VehicleHealth[]>();
  for (const h of input.health) {
    if (h.depotId === null || !inScope(input.scope, h.depotId)) continue;
    const held = groups.get(h.depotId);
    if (held) held.push(h);
    else groups.set(h.depotId, [h]);
  }
  const out: Decision[] = [];
  for (const [depotId, list] of groups) {
    const risky = list.filter((h) => h.band === 'high' && (h.state === 'in_service' || h.state === 'on_road'));
    if (risky.length === 0) continue;
    const standby = list.filter((h) => h.state === 'standing' && h.band === 'normal' && h.service.group !== 'overdue').length;
    const name = byId.get(depotId)?.name ?? depotId;
    const top = [...risky].sort((a, b) => b.risk - a.risk)[0]!;
    const overdue = list.filter((h) => h.service.group === 'overdue').length;
    const swap = Math.min(standby, risky.length);
    out.push({
      id: `maintenance:${depotId}`,
      category: 'maintenance',
      severity: risky.length >= 3 ? 'high' : 'medium',
      weight: risky.reduce((s, h) => s + h.risk, 0),
      title: `${name}: ${formatCount(risky.length)} high-risk bus${risky.length === 1 ? ' is' : 'es are'} on the road`,
      entity: { kind: 'depot', id: depotId, label: name },
      depotId,
      timing: 'Today · before their next duty',
      detected: `${formatCount(risky.length)} buses score ${RISK_BANDS.high} or more on the breakdown-risk index and are running now; the highest is ${top.registration} at ${top.risk} (${top.factors[0]?.label ?? 'several factors'}).`,
      whyItMatters: `A breakdown mid-journey strands passengers and takes the bus's later duties with it; ${formatCount(overdue)} of the depot's buses are past their service.`,
      evidence: [
        { label: 'High-risk on the road', value: formatCount(risky.length), status: 'derived' },
        { label: 'Highest index', value: `${top.registration} · ${top.risk}`, status: 'estimate' },
        { label: 'Service overdue', value: formatCount(overdue), status: 'estimate' },
        { label: 'Standby buses fit to swap', value: formatCount(standby), status: 'derived' },
      ],
      recommendation: {
        title: swap > 0 ? `Swap ${formatCount(swap)} at the end of their current trip` : 'Inspect at the end of the current trip',
        detail: swap > 0 ? 'Bring each in at the end of its trip and send a standby bus that is not overdue for service.' : 'No fit standby bus is standing in the yard: inspect and decide bus by bus.',
        impact: swap > 0 ? `Removes ${formatCount(swap)} of ${formatCount(risky.length)} high-risk buses from service today.` : 'Earlier detection of a fault before it strands a bus.',
        tradeOff: swap > 0 ? `Uses ${formatCount(swap)} of ${formatCount(standby)} standby buses.` : 'The bus may miss a duty while inspected.',
      },
      alternatives: [
        {
          title: 'Book them into the next free workshop bay',
          detail: 'Keep them running today; service them first tomorrow.',
          impact: 'No duty lost today.',
          tradeOff: 'The risk stays on the road for the rest of the day.',
        },
      ],
      impact: `${formatCount(swap)} high-risk buses withdrawn before failure; ${formatCount(risky.length - swap)} remain for inspection.`,
      approval: APPROVAL_MAINTENANCE,
      links: [
        { label: 'Fleet Health', href: `${depotHref(depotId)}/health` },
        { label: 'Predictive Maintenance', href: `${depotHref(depotId)}/maintenance` },
        { label: 'Headquarters fleet health', href: RELIABILITY_PATH },
      ],
      basis: 'estimate',
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, THRESHOLDS.maxPerCategory);
}

function fuelDecisions(input: DecisionInput, byId: ReadonlyMap<string, DepotSummary>): Decision[] {
  if (!input.fuel) return [];
  const groups = new Map<string, { journeys: number; litres: number; rupees: number; vehicles: Set<string>; recurring: Set<string> }>();
  for (const j of input.fuel.flagged) {
    if (j.depotId === null || !inScope(input.scope, j.depotId)) continue;
    const g = groups.get(j.depotId) ?? { journeys: 0, litres: 0, rupees: 0, vehicles: new Set<string>(), recurring: new Set<string>() };
    g.journeys += 1;
    g.litres += j.excessLitres;
    g.rupees += j.exposureRupees;
    g.vehicles.add(j.registration);
    if (j.recurrence >= 2) g.recurring.add(j.registration);
    groups.set(j.depotId, g);
  }
  const out: Decision[] = [];
  for (const [depotId, g] of groups) {
    if (g.rupees < THRESHOLDS.fuelMediumRupees / 2) continue;
    const name = byId.get(depotId)?.name ?? depotId;
    const severity: Severity = g.rupees >= THRESHOLDS.fuelHighRupees ? 'high' : g.rupees >= THRESHOLDS.fuelMediumRupees ? 'medium' : 'low';
    out.push({
      id: `fuel:${depotId}`,
      category: 'fuel',
      severity,
      weight: g.rupees,
      title: `${name}: ${formatCount(g.journeys)} journeys drew ${formatCount(Math.round(g.litres))} L more fuel than expected`,
      entity: { kind: 'depot', id: depotId, label: name },
      depotId,
      timing: 'Last 14 completed days',
      detected: `${formatCount(g.journeys)} journeys on ${formatCount(g.vehicles.size)} buses consumed at least 10% more than each bus's own median economy${g.recurring.size > 0 ? `; ${formatCount(g.recurring.size)} bus${g.recurring.size === 1 ? '' : 'es'} recur` : ''}.`,
      whyItMatters: `An estimated ${rupees(g.rupees)} of diesel is unaccounted for until each journey is verified.`,
      evidence: [
        { label: 'Flagged journeys', value: formatCount(g.journeys), status: 'derived' },
        { label: 'Excess fuel', value: `${formatCount(Math.round(g.litres))} L`, status: 'estimate' },
        { label: 'Exposure', value: rupees(g.rupees), status: 'estimate' },
        { label: 'Recurring buses', value: formatCount(g.recurring.size), status: 'derived' },
      ],
      recommendation: {
        title: g.recurring.size > 0 ? `Open verification cases for the ${formatCount(g.recurring.size)} recurring bus${g.recurring.size === 1 ? '' : 'es'}` : 'Open verification cases for the largest journeys',
        detail: 'Check each issue against the pump register and the GPS distance before any conclusion.',
        impact: `Covers ${pct(g.recurring.size > 0 ? Math.min(1, g.recurring.size / g.vehicles.size) : 0.5)} of the flagged buses with the most exposure.`,
        tradeOff: 'Accounts staff time; most single anomalies are recording errors.',
      },
      alternatives: [
        {
          title: 'Schedule an economy check at the next service',
          detail: 'Treat it as mechanical first: injectors, tyres, brakes.',
          impact: 'Fixes inefficiency if that is the cause.',
          tradeOff: 'Does not verify the issue records.',
        },
      ],
      impact: `Exposure of ${rupees(g.rupees)} quantified and assigned for verification.`,
      approval: APPROVAL_FUEL,
      links: [
        { label: 'Fuel Audit', href: `${depotHref(depotId)}/fuel-audit` },
        { label: 'Headquarters fuel audit', href: FUEL_AUDIT_PATH },
      ],
      basis: 'scenario',
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, THRESHOLDS.maxPerCategory);
}

function telemetryDecisions(input: DecisionInput): Decision[] {
  return input.network.depots
    // A summary without its state mix (a partial record) is skipped, never read as zero.
    .filter((d) => d.kind === 'depot' && d.fleet >= THRESHOLDS.darkMinFleet && d.states !== undefined && inScope(input.scope, d.id))
    .map((d) => ({ d, share: d.states.dark / d.fleet }))
    .filter(({ share }) => share >= THRESHOLDS.darkMedium)
    .sort((a, b) => b.share - a.share)
    .slice(0, THRESHOLDS.maxPerCategory)
    .map(({ d, share }): Decision => ({
      id: `telemetry:${d.id}`,
      category: 'telemetry',
      severity: share >= THRESHOLDS.darkHigh ? 'high' : 'medium',
      weight: d.states.dark,
      title: `${d.name}: ${formatCount(d.states.dark)} of ${formatCount(d.fleet)} buses have no GPS signal`,
      entity: { kind: 'depot', id: d.id, label: d.name },
      depotId: d.id,
      timing: 'Now',
      detected: `${pct(share)} of the depot's fleet is dark: no position for the dark threshold or longer.`,
      whyItMatters: 'A dark bus cannot be confirmed ready, located for a breakdown, or counted in any coverage figure.',
      evidence: [
        { label: 'Dark buses', value: formatCount(d.states.dark), status: 'live' },
        { label: 'Fleet', value: formatCount(d.fleet), status: 'live' },
        { label: 'Reporting now', value: formatCount(d.reporting), status: 'live' },
      ],
      recommendation: {
        title: 'Check the telematics units and confirm status by phone',
        detail: 'Start with buses due out at the next peak.',
        impact: `Restores visibility of up to ${formatCount(d.states.dark)} buses.`,
        tradeOff: 'Controller time; some units may need workshop attention.',
      },
      alternatives: [],
      impact: `Readiness of ${formatCount(d.states.dark)} buses becomes verifiable.`,
      approval: 'The depot controller decides which units to check first.',
      links: [{ label: 'Depot Mission Control', href: depotHref(d.id) }],
      basis: 'live',
    }));
}

function compare(a: Decision, b: Decision): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.weight - a.weight || a.id.localeCompare(b.id);
}

/** Every decision in scope, most urgent first. */
export function buildDecisions(input: DecisionInput): readonly Decision[] {
  const byId = new Map(input.network.depots.map((d) => [d.id, d]));
  return [
    ...shortageDecisions(input, byId),
    ...redistributionDecision(input),
    ...incidentDecisions(input),
    ...maintenanceDecisions(input, byId),
    ...fuelDecisions(input, byId),
    ...telemetryDecisions(input),
  ].sort(compare);
}

/** The decision in its own depot's Decision Center, or Headquarters' when it has no depot. */
export function decisionHref(id: string, depotId: string | null = null): string {
  const base = depotId ? `${depotHref(depotId)}/decisions` : DECISIONS_PATH;
  return `${base}?d=${encodeURIComponent(id)}`;
}

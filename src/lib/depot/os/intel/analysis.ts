import type { DepotDistributionResponse, DepotNetworkResponse } from '../../api';
import { depotHref } from '../../depotNav';
import { formatCount, signFor } from '../../format';
import type { IncidentRollupResponse } from '../../incident/api';
import { INCIDENTS_PATH, REBALANCE_PATH } from '../../nav';
import type { DataStatus } from '../dataStatus';
import type { FleetBus } from '../fleetIndex';
import { DECISIONS_PATH, FUEL_AUDIT_PATH, MISSION_PATH, RELIABILITY_PATH, SECTION_ANCHOR, type AiKind } from '../workspaces';
import { buildDecisions, decisionHref } from './decisions';
import type { FuelAudit } from './fuelAudit';
import type { Decision, Severity } from './types';
import type { VehicleHealth } from './vehicleHealth';

/**
 * The AI engine's analysis cycle, pure. A cycle runs the decision engine on the current
 * snapshot, reads what the other engines found (health, fuel audit, distribution,
 * incidents, the feed), and compares the result with the previous cycle's. What changed
 * becomes the activity stream; nothing is invented between cycles, so a quiet network
 * gives a quiet stream. The caller supplies the clock; this file never reads one.
 */

export interface AnalysisInput {
  readonly network: DepotNetworkResponse;
  readonly distribution: DepotDistributionResponse | null;
  readonly incidents: IncidentRollupResponse | null;
  readonly fleet: readonly FleetBus[] | null;
  readonly health: readonly VehicleHealth[] | null;
  readonly fuel: FuelAudit | null;
  /** The context's depot ids, or null for the whole network. */
  readonly scope: ReadonlySet<string> | null;
  /** A key of the context, so a change of context starts a fresh comparison. */
  readonly scopeKey: string;
  readonly scopeLabel: string;
  /** The depot when the context is one depot, for links. */
  readonly depotId: string | null;
}

export interface Findings {
  readonly scopeKey: string;
  readonly feedNow: string | null;
  /** Hour of the feed clock, 0–23, or null without a clock. */
  readonly feedHour: number | null;
  readonly fleet: number;
  /** Buses with a position and a recent fix (not dark). */
  readonly positioned: number;
  readonly onRoad: number;
  readonly offRoad: number;
  readonly dark: number;
  readonly shortDepots: readonly { readonly id: string; readonly name: string; readonly balance: number }[];
  readonly busesShort: number;
  readonly surplusBuses: number;
  readonly transfers: number;
  readonly busesToMove: number;
  readonly incidents: number;
  /** Depots the breakdown screen has still to cover; its figures settle at 0. */
  readonly screenPending: number;
  readonly highRisk: number;
  readonly overdue: number;
  readonly fuelFlags: number | null;
  readonly fuelExposure: number | null;
  readonly decisions: readonly Pick<Decision, 'id' | 'title' | 'severity' | 'category' | 'depotId'>[];
  readonly critical: number;
  /** Analyses the cycle ran or read, for the engine panel. */
  readonly analyses: number;
}

export interface ActivityDraft {
  /** Stable for the thing it is about, so a repeat replaces rather than piles up. */
  readonly key: string;
  readonly kind: AiKind;
  readonly status: DataStatus;
  readonly text: string;
  readonly href: string | null;
  readonly severity?: Severity;
}

const inScope = (id: string | null, scope: ReadonlySet<string> | null): boolean => scope === null || (id !== null && scope.has(id));

function feedHourOf(feedNow: string | null): number | null {
  if (!feedNow) return null;
  const match = /T(\d{2}):/.exec(feedNow);
  return match ? Number(match[1]) : null;
}

/** One cycle's findings for the context. */
export function findingsOf(input: AnalysisInput): Findings {
  const { network, distribution, incidents, fleet, health, fuel, scope } = input;
  const decisions = buildDecisions({ network, distribution, incidents, health, fuel, scope });
  const depots = network.depots.filter((d) => d.kind === 'depot' && inScope(d.id, scope) && d.states);
  const sum = (pick: (d: (typeof depots)[number]) => number): number => depots.reduce((s, d) => s + pick(d), 0);
  const balances = (distribution?.balances ?? []).filter((b) => b.kind === 'depot' && inScope(b.depotId, scope));
  const short = balances.filter((b) => b.balance < 0).sort((a, b) => a.balance - b.balance);
  const transfers = (distribution?.plan.transfers ?? []).filter((t) => inScope(t.fromDepotId, scope) || inScope(t.toDepotId, scope));
  const scopedFleet = (fleet ?? []).filter((b) => inScope(b.depotId, scope));
  const scopedHealth = (health ?? []).filter((h) => inScope(h.depotId, scope));
  const flagged = fuel ? fuel.flagged.filter((j) => inScope(j.depotId, scope)) : null;
  return {
    scopeKey: input.scopeKey,
    feedNow: network.feedNow,
    feedHour: feedHourOf(network.feedNow),
    fleet: sum((d) => d.fleet),
    positioned: scopedFleet.filter((b) => b.lat !== null && b.lng !== null && b.state !== 'dark').length,
    onRoad: sum((d) => d.states.inService + d.states.onRoad),
    offRoad: sum((d) => d.states.offRoad),
    dark: sum((d) => d.states.dark),
    shortDepots: short.map((b) => ({ id: b.depotId, name: b.depotName, balance: b.balance })),
    busesShort: short.reduce((s, b) => s - b.balance, 0),
    surplusBuses: balances.reduce((s, b) => s + Math.max(0, b.balance), 0),
    transfers: transfers.length,
    busesToMove: transfers.reduce((s, t) => s + t.buses, 0),
    incidents: (incidents?.rows ?? []).filter((r) => inScope(r.depotId, scope)).length,
    screenPending: incidents?.pending ?? 0,
    highRisk: scopedHealth.filter((h) => h.band === 'high').length,
    overdue: scopedHealth.filter((h) => h.service.group === 'overdue').length,
    fuelFlags: flagged ? flagged.length : null,
    fuelExposure: flagged ? flagged.reduce((s, j) => s + j.exposureRupees, 0) : null,
    decisions: decisions.map((d) => ({ id: d.id, title: d.title, severity: d.severity, category: d.category, depotId: d.depotId })),
    critical: decisions.filter((d) => d.severity === 'critical').length,
    analyses: 1 + (distribution ? 2 : 0) + (incidents ? 1 : 0) + (health ? 1 : 0) + (fuel ? 1 : 0) + (fleet ? 1 : 0),
  };
}

const signed = (n: number): string => `${signFor(n)}${formatCount(Math.abs(n))}`;

const clockText = (feedNow: string | null): string => {
  const match = feedNow ? /T(\d{2}:\d{2})/.exec(feedNow) : null;
  return match ? match[1]! : 'the latest snapshot';
};

const PEAK_BANDS: readonly { readonly from: number; readonly to: number; readonly label: string }[] = [
  { from: 6, to: 10, label: 'Morning peak 06:00–10:00' },
  { from: 16, to: 20, label: 'Evening peak 16:00–20:00' },
];

/** The full sequence for a first cycle (or a new context): one line per analysis, in order. */
function opening(next: Findings, input: AnalysisInput): ActivityDraft[] {
  const base = input.depotId ? depotHref(input.depotId) : null;
  const out: ActivityDraft[] = [
    {
      key: 'feed',
      kind: 'monitor',
      status: 'live',
      text: `GPS snapshot of ${clockText(next.feedNow)} read for ${input.scopeLabel}: ${formatCount(next.positioned)} buses reporting, ${formatCount(next.onRoad)} on the road.`,
      href: base ? `${base}/cockpit` : MISSION_PATH,
    },
    {
      key: 'health',
      kind: 'predict',
      status: 'estimate',
      text: `Fleet health recomputed: ${formatCount(next.highRisk)} buses at high breakdown risk, ${formatCount(next.overdue)} past service due.`,
      href: base ? `${base}/health` : RELIABILITY_PATH,
    },
  ];
  if (next.fuelFlags !== null) {
    out.push({
      key: 'fuel',
      kind: 'anomaly',
      status: 'scenario',
      text: `Fuel audit: ${formatCount(next.fuelFlags)} journeys above their bus's own economy, ₹${formatCount(next.fuelExposure ?? 0)} to verify.`,
      href: `${base ? `${base}/fuel-audit` : FUEL_AUDIT_PATH}?section=${SECTION_ANCHOR.anomalyQueue}`,
    });
  }
  out.push({
    key: 'balance',
    kind: 'predict',
    status: 'estimate',
    text:
      next.shortDepots.length > 0
        ? `Peak fleet need evaluated: ${formatCount(next.shortDepots.length)} depot${next.shortDepots.length === 1 ? '' : 's'} short by ${formatCount(next.busesShort)} buses; worst ${next.shortDepots[0]!.name} (${signed(next.shortDepots[0]!.balance)}).`
        : 'Peak fleet need evaluated: no depot in this context is short.',
    href: REBALANCE_PATH,
    severity: next.shortDepots.length > 0 ? 'high' : undefined,
  });
  if (next.transfers > 0) {
    out.push({
      key: 'transfers',
      kind: 'optimize',
      status: 'proposed',
      text: `Redistribution proposal prepared: ${formatCount(next.transfers)} transfers moving ${formatCount(next.busesToMove)} buses.`,
      href: `${REBALANCE_PATH}?section=${SECTION_ANCHOR.transfers}`,
    });
  }
  out.push({
    key: 'incidents',
    kind: 'anomaly',
    status: 'derived',
    text:
      next.screenPending > 0
        ? `Breakdown screen running: ${formatCount(next.incidents)} likely incident${next.incidents === 1 ? '' : 's'} so far, ${formatCount(next.screenPending)} depots still to cover.`
        : `Breakdown screen: ${formatCount(next.incidents)} likely incident${next.incidents === 1 ? '' : 's'} on the road.`,
    href: base ? `${base}/incidents` : INCIDENTS_PATH,
    severity: next.incidents > 0 ? 'high' : undefined,
  });
  out.push({
    key: 'queue',
    kind: 'recommend',
    status: 'derived',
    text: `Decision queue ranked: ${formatCount(next.decisions.length)} decisions, ${formatCount(next.critical)} critical.`,
    href: base ? `${base}/decisions` : DECISIONS_PATH,
    severity: next.critical > 0 ? 'critical' : undefined,
  });
  return out;
}

function changed(label: string, was: number, now: number): string {
  return `${label} ${formatCount(now)} (was ${formatCount(was)})`;
}

/**
 * What a cycle adds to the stream: the opening sequence on a first cycle or a new
 * context, otherwise only what moved since the last cycle (a new feed snapshot, a new or
 * cleared decision, a shortage or plan that changed, the feed clock entering a peak).
 */
export function cycleEvents(prev: Findings | null, next: Findings, input: AnalysisInput): ActivityDraft[] {
  if (!prev || prev.scopeKey !== next.scopeKey) return opening(next, input);
  const out: ActivityDraft[] = [];
  const base = input.depotId ? depotHref(input.depotId) : null;
  if (next.feedNow !== prev.feedNow) {
    const delta = next.onRoad - prev.onRoad;
    out.push({
      key: `feed:${next.feedNow ?? ''}`,
      kind: 'monitor',
      status: 'live',
      text: `New GPS snapshot ${clockText(next.feedNow)}: ${formatCount(next.onRoad)} on the road${delta === 0 ? '' : ` (${signed(delta)})`}, ${formatCount(next.dark)} without a recent fix.`,
      href: base ? `${base}/cockpit` : MISSION_PATH,
    });
  }
  if (next.feedHour !== null && next.feedHour !== prev.feedHour) {
    const band = PEAK_BANDS.find((b) => next.feedHour! >= b.from && next.feedHour! < b.to);
    const ahead = PEAK_BANDS.find((b) => next.feedHour! + 1 === b.from);
    if (band || ahead) {
      out.push({
        key: `hour:${next.feedHour}`,
        kind: 'predict',
        status: 'forecast',
        text: band
          ? `${band.label} in progress: the demand forecast puts ${formatCount(next.shortDepots.length)} depots short by ${formatCount(next.busesShort)} buses.`
          : `${ahead!.label} starts within the hour: ${formatCount(next.busesShort)} buses short across ${formatCount(next.shortDepots.length)} depots.`,
        href: `/project/depots/service?section=${SECTION_ANCHOR.demandHeatmap}`,
        severity: next.busesShort > 0 ? 'high' : undefined,
      });
    }
  }
  // While the breakdown screen is still covering depots its counts (and the incident
  // decisions they rank) grow as it goes; that is coverage, not change, so it is reported
  // once, when the screen completes, and decisions are compared only between settled cycles.
  const settled = prev.screenPending === 0 && next.screenPending === 0;
  if (prev.screenPending > 0 && next.screenPending === 0) {
    out.push({
      key: 'incidents',
      kind: 'anomaly',
      status: 'derived',
      text: `Breakdown screen complete across every depot: ${formatCount(next.incidents)} likely incident${next.incidents === 1 ? '' : 's'}; decision queue ${formatCount(next.decisions.length)}, ${formatCount(next.critical)} critical.`,
      href: base ? `${base}/incidents` : INCIDENTS_PATH,
      severity: next.incidents > 0 ? 'high' : undefined,
    });
  }
  const before = new Map(prev.decisions.map((d) => [d.id, d]));
  const after = new Map(next.decisions.map((d) => [d.id, d]));
  for (const d of settled ? next.decisions : []) {
    if (before.has(d.id) || (d.severity !== 'critical' && d.severity !== 'high')) continue;
    out.push({ key: `new:${d.id}`, kind: 'recommend', status: 'derived', text: `New ${d.severity} decision: ${d.title}.`, href: decisionHref(d.id, input.depotId), severity: d.severity });
  }
  for (const d of settled ? prev.decisions : []) {
    if (after.has(d.id) || (d.severity !== 'critical' && d.severity !== 'high')) continue;
    out.push({ key: `cleared:${d.id}`, kind: 'monitor', status: 'derived', text: `Cleared on the latest snapshot: ${d.title}.`, href: null });
  }
  if (next.busesShort !== prev.busesShort || next.shortDepots.length !== prev.shortDepots.length) {
    out.push({
      key: 'balance',
      kind: 'predict',
      status: 'estimate',
      text: `Peak shortage re-evaluated: ${changed('buses short', prev.busesShort, next.busesShort)} across ${formatCount(next.shortDepots.length)} depots.`,
      href: REBALANCE_PATH,
      severity: next.busesShort > prev.busesShort ? 'high' : undefined,
    });
  }
  if (next.transfers !== prev.transfers || next.busesToMove !== prev.busesToMove) {
    out.push({
      key: 'transfers',
      kind: 'optimize',
      status: 'proposed',
      text: `Redistribution re-optimised: ${changed('transfers', prev.transfers, next.transfers)}, ${formatCount(next.busesToMove)} buses to move.`,
      href: `${REBALANCE_PATH}?section=${SECTION_ANCHOR.transfers}`,
    });
  }
  if (next.highRisk !== prev.highRisk || next.overdue !== prev.overdue) {
    out.push({
      key: 'health',
      kind: 'predict',
      status: 'estimate',
      text: `Fleet health recomputed: ${changed('high-risk buses', prev.highRisk, next.highRisk)}, ${formatCount(next.overdue)} past service due.`,
      href: base ? `${base}/health` : RELIABILITY_PATH,
    });
  }
  if (settled && next.incidents !== prev.incidents) {
    out.push({
      key: 'incidents',
      kind: 'anomaly',
      status: 'derived',
      text: `Breakdown screen: ${changed('likely incidents', prev.incidents, next.incidents)}.`,
      href: base ? `${base}/incidents` : INCIDENTS_PATH,
      severity: next.incidents > prev.incidents ? 'high' : undefined,
    });
  }
  if (next.fuelFlags !== null && next.fuelFlags !== prev.fuelFlags) {
    out.push({
      key: 'fuel',
      kind: 'anomaly',
      status: 'scenario',
      text: `Fuel audit ${prev.fuelFlags === null ? 'complete' : 'updated'}: ${formatCount(next.fuelFlags)} journeys to verify, ₹${formatCount(next.fuelExposure ?? 0)} exposure.`,
      href: `${base ? `${base}/fuel-audit` : FUEL_AUDIT_PATH}?section=${SECTION_ANCHOR.anomalyQueue}`,
    });
  }
  return out;
}

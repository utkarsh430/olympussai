import type { DepotDistributionResponse, DepotNetworkResponse } from '../../api';
import { shortDate } from '../words';
import { depotHref, incidentBusHref } from '../../depotNav';
import { formatCount } from '../../format';
import type { IncidentRollupResponse } from '../../incident/api';
import { SIGNAL_TEXT } from '../../incident/incidentWording';
import { BUS_STATE_LABEL } from '../../labels';
import { REBALANCE_PATH } from '../../nav';
import { runScenario } from '../../optimise/scenario';
import type { DepotSummary } from '../../types';
import type { DataStatus } from '../dataStatus';
import type { FleetBus } from '../fleetIndex';
import { FUEL_AUDIT_PATH, RELIABILITY_PATH, SIMULATION_PATH } from '../workspaces';
import { buildBriefing } from './briefing';
import { compareAnswer, crewAnswer, scheduleAnswer, underusedAnswer } from './copilotSched';
import { decisionHref } from './decisions';
import { auditVehicle, type FuelAudit } from './fuelAudit';
import type { Decision } from './types';
import { FAULT_LABEL, summariseHealth, type VehicleHealth } from './vehicleHealth';

/**
 * The copilot's own answers: a fixed set of intents, each answered from the records the
 * workspaces show (the decision queue, the fleet index, fleet health, the fuel audit, the
 * redistribution plan and the scheduling engine), with the action that opens the records
 * behind it. A question outside these intents returns null and is passed to the AI Engine
 * on the server. No answer names, scores or judges a person.
 */

export interface CopilotData {
  readonly network: DepotNetworkResponse | null;
  readonly distribution: DepotDistributionResponse | null;
  readonly incidents: IncidentRollupResponse | null;
  readonly fleet: readonly FleetBus[] | null;
  readonly health: readonly VehicleHealth[] | null;
  readonly healthByReg: ReadonlyMap<string, VehicleHealth>;
  readonly fuel: FuelAudit | null;
  readonly decisions: readonly Decision[];
  readonly operatingDate: string | null;
  /** In one depot's scope: the duty plan's spare buses (no duty today); null when not loaded. */
  readonly spareBuses?: readonly string[] | null;
}

export interface CopilotContext {
  /** The depot in scope (from the address), or null at Headquarters. */
  readonly depotId: string | null;
  /** The region chosen at Headquarters, as a name, or null. */
  readonly regionName: string | null;
  /** The depot ids in scope; null for all. */
  readonly scope: ReadonlySet<string> | null;
  /** What the page has in focus: a vehicle, a decision, a journey. */
  readonly focus: { readonly kind: string; readonly id: string; readonly label: string } | null;
  /** The view the person is on, for "this view". */
  readonly viewLabel: string | null;
}

export type CopilotAction =
  | { readonly label: string; readonly href: string }
  | { readonly label: string; readonly vehicle: string; readonly depotId: string | null }
  | { readonly label: string; readonly depot: string }
  | { readonly label: string; readonly ask: string };

export interface LocalAnswer {
  readonly intent: string;
  readonly headline: string;
  readonly paragraphs: readonly string[];
  readonly bullets: readonly string[];
  readonly actions: readonly CopilotAction[];
  readonly status: DataStatus;
}

const MAX_LISTED = 5;
const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };
const REGISTRATION = /\b([a-z]{2})[\s-]?(\d{1,2})[\s-]?([a-z]{0,3})[\s-]?(\d{3,4})\b/i;

const normalise = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function findBus(question: string, fleet: readonly FleetBus[] | null): FleetBus | null {
  if (!fleet) return null;
  const match = REGISTRATION.exec(question);
  if (!match) return null;
  const wanted = normalise(match[0]);
  return fleet.find((b) => normalise(b.registration) === wanted) ?? null;
}

function findDepot(question: string, depots: readonly DepotSummary[]): DepotSummary | null {
  const q = question.toLowerCase();
  let best: DepotSummary | null = null;
  for (const d of depots) {
    const name = d.name.toLowerCase();
    if (name.length >= 3 && q.includes(name) && (!best || name.length > best.name.length)) best = d;
  }
  return best;
}

function scopeName(ctx: CopilotContext, depots: ReadonlyMap<string, DepotSummary>): string {
  if (ctx.depotId) return depots.get(ctx.depotId)?.name ?? `Depot ${ctx.depotId}`;
  return ctx.regionName ? `${ctx.regionName} region` : 'Headquarters';
}

function inScope(scope: ReadonlySet<string> | null, depotId: string | null): boolean {
  return scope === null || (depotId !== null && scope.has(depotId));
}

function vehicleAnswer(bus: FleetBus, data: CopilotData, depots: ReadonlyMap<string, DepotSummary>): LocalAnswer {
  const health = data.healthByReg.get(bus.registration) ?? null;
  const fuel = data.operatingDate ? auditVehicle(bus, data.operatingDate) : null;
  const flagged = fuel?.journeys.filter((j) => j.flagged) ?? [];
  const incident = data.incidents?.rows.find((r) => r.registrationNumber === bus.registration) ?? null;
  const depotName = bus.depotId ? (depots.get(bus.depotId)?.name ?? bus.depotId) : 'no home depot';
  const bullets = [
    `State: ${BUS_STATE_LABEL[bus.state].toLowerCase()}${bus.routeName ? ` on ${bus.routeName}` : ''}; last GPS fix ${bus.gpsAgeMin === null ? 'unknown' : `${bus.gpsAgeMin} min ago`}.`,
  ];
  if (health) {
    bullets.push(
      `Breakdown-risk index ${health.risk} (${health.band})${health.factors[0] ? `, led by: ${health.factors[0].label.toLowerCase()}` : ''}.`,
    );
    if (health.recurring) bullets.push(`Recurring fault: ${FAULT_LABEL[health.recurring].toLowerCase()}.`);
  }
  if (fuel) {
    bullets.push(
      flagged.length > 0
        ? `${flagged.length} of ${fuel.journeys.length} journeys in 14 days flagged for excess fuel (${formatCount(Math.round(flagged.reduce((s, j) => s + j.excessLitres, 0)))} L).`
        : `No journey flagged for excess fuel in 14 days; median ${fuel.medianKmPerLitre?.toFixed(2) ?? '—'} km/L.`,
    );
  }
  if (incident) bullets.push(`Suspected breakdown (${incident.confidence} confidence): ${incident.signals.map((s) => SIGNAL_TEXT[s].toLowerCase()).join('; ')}.`);
  const actions: CopilotAction[] = [{ label: 'Open vehicle profile', vehicle: bus.registration, depotId: bus.depotId }];
  if (incident) actions.push({ label: 'Open the incident', href: incidentBusHref(incident.depotId, bus.registration) });
  if (bus.depotId) actions.push({ label: 'Disruption if unavailable', href: `${depotHref(bus.depotId)}/disruption?bus=${encodeURIComponent(bus.registration)}` });
  return {
    intent: 'vehicle',
    headline: `${bus.registration} · ${depotName}`,
    paragraphs: [],
    bullets,
    actions,
    status: 'derived',
  };
}

function shortageAnswer(depot: DepotSummary | null, data: CopilotData, ctx: CopilotContext): LocalAnswer {
  const shortages = data.decisions.filter((d) => d.category === 'shortage' && (depot ? d.depotId === depot.id : true));
  if (depot) {
    const balance = data.distribution?.balances.find((b) => b.depotId === depot.id) ?? null;
    const own = shortages[0];
    if (!own || !balance) {
      return {
        intent: 'shortage',
        headline: `${depot.name} is not short for the morning peak`,
        paragraphs: balance
          ? [`It has ${formatCount(balance.available)} buses available against a need of ${formatCount(balance.required)} (peak ${formatCount(balance.peakRequirement)} plus ${formatCount(balance.spareTarget)} spare): ${balance.balance >= 0 ? `${formatCount(balance.balance)} to spare` : ''}.`]
          : ['The distribution figures have not loaded yet.'],
        bullets: [],
        actions: [{ label: 'Between Depots', href: REBALANCE_PATH }],
        status: 'estimate',
      };
    }
    return {
      intent: 'shortage',
      headline: own.title,
      paragraphs: [own.detected, own.whyItMatters],
      bullets: [
        `Main cause: ${formatCount(balance.offRoad)} buses off the road leave ${formatCount(balance.available)} of ${formatCount(balance.fleet)} available.`,
        `Recommended: ${own.recommendation.title}. ${own.recommendation.impact}`,
        ...own.alternatives.slice(0, 2).map((a) => `Alternative: ${a.title}. ${a.impact}`),
      ],
      actions: [
        { label: 'Open the decision', href: decisionHref(own.id, own.depotId) },
        { label: 'Between Depots', href: REBALANCE_PATH },
        { label: 'Try it in Scenario Studio', href: `${SIMULATION_PATH}?depot=${encodeURIComponent(depot.id)}` },
      ],
      status: 'estimate',
    };
  }
  const scoped = shortages.filter((d) => inScope(ctx.scope, d.depotId));
  const total = scoped.reduce((s, d) => s + d.weight, 0);
  return {
    intent: 'shortage',
    headline:
      scoped.length === 0 ? 'No depot in scope is short for the morning peak' : `${formatCount(scoped.length)} depots short by ${formatCount(total)} buses at the morning peak`,
    paragraphs: [],
    bullets: scoped.slice(0, MAX_LISTED).map((d) => `${d.title}. ${d.recommendation.title}.`),
    actions: [
      { label: 'Between Depots', href: REBALANCE_PATH },
      ...scoped.slice(0, 2).map((d) => ({ label: `Open ${d.entity.label}`, href: decisionHref(d.id, d.depotId) })),
    ],
    status: 'estimate',
  };
}

function coverAnswer(depot: DepotSummary | null, data: CopilotData, ctx: CopilotContext): LocalAnswer {
  const health = data.health ?? [];
  const fit = (h: VehicleHealth): boolean => h.state === 'standing' && h.band === 'normal' && h.service.group !== 'overdue';
  // In a depot with its duty plan loaded, only buses the plan leaves free count, as on Dispatch Readiness.
  const spare = depot && data.spareBuses ? new Set(data.spareBuses) : null;
  const pool = health.filter((h) => fit(h) && (depot ? h.depotId === depot.id : inScope(ctx.scope, h.depotId)) && (spare === null || spare.has(h.registration)));
  const ranked = [...pool].sort((a, b) => a.risk - b.risk || a.registration.localeCompare(b.registration));
  const fitStanding = depot ? health.filter((h) => fit(h) && h.depotId === depot.id).length : 0;
  const paragraphs =
    spare !== null
      ? [
          ranked.length === 0
            ? `All ${formatCount(fitStanding)} fit standing buses already hold a duty today. Buses that went dark inside the yard can be confirmed and used; Dispatch Readiness proposes them.`
            : 'Free means the duty plan leaves the bus without a duty today; fit means standing, not past its service and with a normal breakdown-risk index.',
        ]
      : ['Fit means standing now, not past its service and with a normal breakdown-risk index. Whether each is free of a duty is on Dispatch Readiness.'];
  return {
    intent: 'cover',
    headline:
      ranked.length === 0
        ? `No free, fit spare bus at ${depot?.name ?? 'this scope'}`
        : `${formatCount(ranked.length)} ${spare !== null ? 'free, fit spare' : 'fit standing'} buses can cover departures${depot ? ` at ${depot.name}` : ''}`,
    paragraphs,
    bullets: ranked.slice(0, MAX_LISTED).map(
      (h) => `${h.registration}: risk ${h.risk}, next service in ${formatCount(Math.max(0, h.service.kmToNextService))} km.`,
    ),
    actions: [
      ...ranked.slice(0, 3).map((h) => ({ label: h.registration, vehicle: h.registration, depotId: h.depotId })),
      ...(depot ? [{ label: 'Dispatch Readiness', href: `${depotHref(depot.id)}/readiness` }] : []),
    ],
    status: 'derived',
  };
}

function incidentAnswer(data: CopilotData, ctx: CopilotContext, name: string): LocalAnswer {
  const rows = (data.incidents?.rows ?? []).filter((r) => inScope(ctx.scope, r.depotId));
  return {
    intent: 'incident',
    headline: rows.length === 0 ? `No suspected breakdown in ${name} on the latest snapshot` : `${formatCount(rows.length)} buses may have broken down in ${name}`,
    paragraphs: [],
    bullets: rows.slice(0, MAX_LISTED).map(
      (r) =>
        `${r.registrationNumber}${r.routeName ? ` on ${r.routeName}` : ''}: ${r.confidence} confidence${r.arrivalMinutes !== null ? `, replacement in about ${r.arrivalMinutes} min` : ', replacement not yet planned'}.`,
    ),
    actions: rows.slice(0, 3).map((r) => ({ label: `Open ${r.registrationNumber}`, href: incidentBusHref(r.depotId, r.registrationNumber) })),
    status: 'derived',
  };
}

function fuelAnswer(data: CopilotData, ctx: CopilotContext, name: string): LocalAnswer {
  if (!data.fuel) {
    return { intent: 'fuel', headline: 'The fuel audit is still running', paragraphs: ['Ask again in a moment.'], bullets: [], actions: [], status: 'scenario' };
  }
  if (ctx.focus?.kind === 'journey') {
    const j = data.fuel.flagged.find((f) => f.id === ctx.focus?.id);
    if (j) {
      return {
        intent: 'fuel-journey',
        headline: `Why ${j.registration} on ${shortDate(j.date)} was flagged`,
        paragraphs: [
          `It drew ${j.fuelLitres} L for ${formatCount(j.distanceKm)} km (${j.kmPerLitre.toFixed(2)} km/L) against ${j.expectedLitres} L expected at its own median of ${j.baselineKmPerLitre.toFixed(2)} km/L: ${j.excessLitres} L (${Math.round(j.variance * 100)}%) over, about ₹${formatCount(j.exposureRupees)}.`,
          'This is an anomaly to verify, not a finding: the causes below are to be checked in order.',
        ],
        bullets: [...j.factors, ...j.explanations.slice(0, 3)],
        actions: [{ label: 'Open the vehicle', vehicle: j.registration, depotId: j.depotId }],
        status: 'scenario',
      };
    }
  }
  const flagged = data.fuel.flagged.filter((j) => inScope(ctx.scope, j.depotId));
  const litres = flagged.reduce((s, j) => s + j.excessLitres, 0);
  const rupees = flagged.reduce((s, j) => s + j.exposureRupees, 0);
  return {
    intent: 'fuel',
    headline: `${formatCount(flagged.length)} journeys flagged for excess fuel in ${name} over 14 days`,
    paragraphs: [
      `About ${formatCount(Math.round(litres))} L above each bus's own median economy, an estimated ₹${formatCount(rupees)} to verify. A flag is a journey to check, never a conclusion.`,
    ],
    bullets: flagged.slice(0, MAX_LISTED).map((j) => `${j.registration} on ${shortDate(j.date)}: +${j.excessLitres} L (${Math.round(j.variance * 100)}%)${j.recurrence >= 2 ? `, recurring ×${j.recurrence}` : ''}.`),
    actions: [{ label: 'Open the fuel audit', href: ctx.depotId ? `${depotHref(ctx.depotId)}/fuel-audit` : FUEL_AUDIT_PATH }],
    status: 'scenario',
  };
}

function maintenanceAnswer(data: CopilotData, ctx: CopilotContext, name: string): LocalAnswer {
  const list = (data.health ?? []).filter((h) => inScope(ctx.scope, h.depotId));
  const s = summariseHealth(list);
  const top = [...list].sort((a, b) => b.risk - a.risk).slice(0, MAX_LISTED);
  return {
    intent: 'maintenance',
    headline: `${name}: ${formatCount(s.highRisk)} high-risk buses, ${formatCount(s.overdue)} past their service`,
    paragraphs: [
      `${formatCount(s.highRiskOnRoad)} of the high-risk buses are on the road now; ${formatCount(s.standbyCandidates)} standing buses are fit to swap in. The index is a points score with every factor listed, not a probability.`,
    ],
    bullets: top.map((h) => `${h.registration}: ${h.risk} — ${h.factors.map((f) => f.label.toLowerCase()).slice(0, 2).join('; ')}.`),
    actions: [
      ...top.slice(0, 2).map((h) => ({ label: h.registration, vehicle: h.registration, depotId: h.depotId })),
      { label: 'Fleet Health', href: ctx.depotId ? `${depotHref(ctx.depotId)}/health` : RELIABILITY_PATH },
    ],
    status: 'estimate',
  };
}

function unavailableAnswer(n: number, depot: DepotSummary | null, data: CopilotData): LocalAnswer | null {
  const dist = data.distribution;
  if (!dist) return null;
  const operating = dist.balances.filter((b) => b.kind === 'depot');
  const targets = depot
    ? [{ depotId: depot.id, deltaBuses: -n }]
    : (() => {
        // Spread across depots by fleet share, largest remainders first, so the total is exact.
        const total = operating.reduce((s, b) => s + b.fleet, 0) || 1;
        const raw = operating.map((b) => ({ depotId: b.depotId, exact: (n * b.fleet) / total }));
        const floors = raw.map((r) => ({ ...r, whole: Math.floor(r.exact) }));
        let left = n - floors.reduce((s, r) => s + r.whole, 0);
        for (const r of [...floors].sort((a, b) => b.exact - b.whole - (a.exact - a.whole))) {
          if (left <= 0) break;
          r.whole += 1;
          left -= 1;
        }
        return floors.filter((r) => r.whole > 0).map((r) => ({ depotId: r.depotId, deltaBuses: -r.whole }));
      })();
  const base = runScenario(dist.balances, {});
  const hit = runScenario(dist.balances, { fleetAdjustments: targets });
  const deficitBefore = base.plan.after.totalDeficit;
  const deficitAfter = hit.plan.after.totalDeficit;
  const own = depot ? { before: base.balances.find((b) => b.depotId === depot.id), after: hit.balances.find((b) => b.depotId === depot.id) } : null;
  const ownLine =
    own?.before && own.after
      ? `${depot!.name}'s own peak balance goes from ${own.before.balance >= 0 ? '+' : ''}${formatCount(own.before.balance)} to ${own.after.balance >= 0 ? '+' : ''}${formatCount(own.after.balance)}${own.after.balance >= 0 ? ': it absorbs the loss from its own spare buses.' : '.'}`
      : null;
  return {
    intent: 'what-if',
    headline: `If ${formatCount(n)} buses${depot ? ` at ${depot.name}` : ' across the network'} become unavailable`,
    paragraphs: [
      ...(ownLine ? [ownLine] : []),
      `After the redistribution plan is re-optimised, the uncovered peak shortage moves from ${formatCount(deficitBefore)} to ${formatCount(deficitAfter)} buses (+${formatCount(deficitAfter - deficitBefore)}); depots still short go from ${formatCount(base.plan.after.depotsInDeficit)} to ${formatCount(hit.plan.after.depotsInDeficit)}.`,
      `Transfers rise from ${formatCount(base.plan.transfers.length)} to ${formatCount(hit.plan.transfers.length)}, with ${formatCount(Math.round(hit.plan.totalBusKm - base.plan.totalBusKm))} more empty bus-km.`,
    ],
    bullets: [],
    actions: [
      {
        label: 'Open in Scenario Studio',
        href: `${SIMULATION_PATH}?unavailable=${n}${depot ? `&depot=${encodeURIComponent(depot.id)}` : ''}`,
      },
    ],
    status: 'scenario',
  };
}

function receiveAnswer(data: CopilotData, depots: ReadonlyMap<string, DepotSummary>): LocalAnswer | null {
  const dist = data.distribution;
  if (!dist) return null;
  const inbound = new Map<string, number>();
  for (const t of dist.plan.transfers) inbound.set(t.toDepotId, (inbound.get(t.toDepotId) ?? 0) + t.buses);
  const ranked = [...inbound.entries()].sort((a, b) => b[1] - a[1]);
  return {
    intent: 'receive',
    headline:
      ranked.length === 0
        ? 'No depot needs buses from another on the current plan'
        : `${depots.get(ranked[0]![0])?.name ?? ranked[0]![0]} should receive the most: ${formatCount(ranked[0]![1])} buses`,
    paragraphs: [
      `The plan moves surplus to deficit by the shortest road distance without taking a donor below its spare target: ${formatCount(dist.plan.coveredDeficit)} of ${formatCount(dist.plan.before.totalDeficit)} buses of shortage covered.`,
    ],
    bullets: ranked.slice(0, MAX_LISTED).map(([id, n]) => `${depots.get(id)?.name ?? id}: +${formatCount(n)}.`),
    actions: [{ label: 'Between Depots', href: REBALANCE_PATH }],
    status: 'proposed',
  };
}

function briefingAnswer(data: CopilotData, ctx: CopilotContext, name: string): LocalAnswer {
  const depots = (data.network?.depots ?? []).filter((d) => inScope(ctx.scope, d.id));
  const briefing = buildBriefing({ scopeLabel: name, depots, decisions: data.decisions, health: data.health?.filter((h) => inScope(ctx.scope, h.depotId)) ?? null, fuel: data.fuel });
  return {
    intent: 'briefing',
    headline: briefing.headline,
    paragraphs: [...briefing.situation, briefing.outlook],
    bullets: briefing.priorities.map((p) => p.text),
    actions: data.decisions.slice(0, 2).map((d) => ({ label: `Open: ${d.entity.label}`, href: decisionHref(d.id, d.depotId) })),
    status: 'derived',
  };
}

function decisionAnswer(decision: Decision): LocalAnswer {
  return {
    intent: 'decision',
    headline: decision.title,
    paragraphs: [decision.detected, decision.whyItMatters],
    bullets: [
      `Recommended: ${decision.recommendation.title}. ${decision.recommendation.impact}`,
      `Trade-off: ${decision.recommendation.tradeOff}`,
      ...decision.alternatives.map((a) => `Alternative: ${a.title}. ${a.impact}`),
      `Approval: ${decision.approval}`,
    ],
    actions: decision.links.slice(0, 2).map((l) => ({ label: l.label, href: l.href })),
    status: decision.basis,
  };
}

/** The copilot's own answer, or null to hand the question to the AI Engine. */
export function localAnswer(question: string, data: CopilotData, ctx: CopilotContext): LocalAnswer | null {
  const q = question.toLowerCase();
  const depots = new Map((data.network?.depots ?? []).map((d) => [d.id, d]));
  const named = findDepot(q, data.network?.depots ?? []);
  const depot = named ?? (ctx.depotId ? (depots.get(ctx.depotId) ?? null) : null);
  const name = named?.name ?? scopeName(ctx, depots);
  const scoped: CopilotContext = named ? { ...ctx, depotId: named.id, scope: new Set([named.id]) } : ctx;

  const bus = findBus(question, data.fleet);
  if (bus) return vehicleAnswer(bus, data, depots);
  if (/\b(this|the selected) (bus|vehicle)\b/.test(q) && ctx.focus?.kind === 'vehicle') {
    const focused = data.fleet?.find((b) => b.registration === ctx.focus?.id);
    if (focused) return vehicleAnswer(focused, data, depots);
  }
  if (/\b(this|the selected) decision\b|\bexplain (this|it)\b/.test(q) && ctx.focus?.kind === 'decision') {
    const d = data.decisions.find((x) => x.id === ctx.focus?.id);
    if (d) return decisionAnswer(d);
  }

  if (/\b(generate|create|make|build|optimi[sz]e)\b.*\b(schedule|timetable|bus plan)\b|\bschedule\b.*\b(tomorrow|today)\b/.test(q)) {
    const answer = scheduleAnswer(named ?? depot, data, q);
    if (answer) return answer;
  }
  if (/under[- ]?(used|utili[sz]ed)|idle buses|spare capacity/.test(q)) {
    const answer = underusedAnswer(named ?? depot, data);
    if (answer) return answer;
  }
  if (/\bcompare\b.*\b(baseline|original|optimi[sz]ed|plan)/.test(q)) {
    const answer = compareAnswer(named ?? depot, data);
    if (answer) return answer;
  }
  if (/\bcrew\b.*\b(roster|schedule|short|enough|cover)|\b(drivers|conductors)\b.*\b(roster|enough|short)/.test(q)) {
    const answer = crewAnswer(named ?? depot, data);
    if (answer) return answer;
  }

  const unavailable =
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\s+(?:more\s+)?(?:buses|bus|vehicles)\s+(?:become|are|go|went|break|fail)?\s*(?:unavailable|off[- ]road|down|out)|(?:lose|losing|remov(?:e|ing)|without|take out|taking out)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\s+(?:buses|bus|vehicles)/.exec(q);
  if (unavailable) {
    const word = unavailable[1] ?? unavailable[2] ?? '';
    const n = NUMBER_WORDS[word] ?? Number(word);
    if (Number.isFinite(n) && n > 0 && n <= 500) return unavailableAnswer(n, named ?? depot, data);
  }
  if (/\bwhy\b.*\bflag|fuel|diesel|km\/l|mileage|anomal/.test(q)) return fuelAnswer(data, scoped, name);
  if (/short(age)?|deficit|not enough buses/.test(q)) return shortageAnswer(depot, data, scoped);
  if (/receive|additional buses|more buses|redistribut|transfer/.test(q)) return receiveAnswer(data, depots);
  if (/cover|replace|spare|standby|available buses|which buses can/.test(q)) return coverAnswer(depot, data, scoped);
  if (/break ?down|broken|incident|tow/.test(q)) return incidentAnswer(data, scoped, name);
  if (/maintenance|service due|overdue|risk|fault|workshop/.test(q)) return maintenanceAnswer(data, scoped, name);
  if (/brief|summar|attention|status|overview|what('s| is) happening|priorit/.test(q)) return briefingAnswer(data, scoped, name);
  return null;
}

/** Questions the dock suggests for the current context. */
export function suggestions(ctx: CopilotContext, depotName: string | null): readonly string[] {
  const where = depotName ?? (ctx.regionName ? `the ${ctx.regionName} region` : 'the network');
  const list = [
    depotName ? `Generate an optimised schedule for ${depotName} tomorrow` : `What needs attention at ${where}?`,
    depotName ? 'Compare baseline and optimised depot operations' : `What needs attention at ${where}?`,
    depotName ? `Why is ${depotName} facing a shortage?` : 'Which depot should receive additional buses?',
    depotName ? `Which buses can cover the next departures at ${depotName}?` : 'Which routes are likely to be underserved at 8 AM?',
    `What happens if ${depotName ? 5 : 15} buses become unavailable${depotName ? ` at ${depotName}` : ''}?`,
    depotName ? 'Show which buses are underutilised this afternoon' : 'Which fuel journeys were flagged and why?',
  ];
  if (ctx.focus?.kind === 'vehicle') list.unshift(`Tell me about bus ${ctx.focus.id}`);
  if (ctx.focus?.kind === 'decision') list.unshift('Explain this decision');
  if (ctx.focus?.kind === 'journey') list.unshift('Why was this fuel journey flagged?');
  return list.slice(0, 6);
}
